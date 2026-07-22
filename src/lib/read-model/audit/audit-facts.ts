import type pg from 'pg';
import { currentYearStart } from '@/lib/read-model/dates';
import { aggregateFactCounts, serializeFactKey } from '@/lib/read-model/metrics';
import { isSummaryEligibleCall } from '@/lib/summary/derive';
import { truncateCurrentYearFacts, upsertFactRows } from '@/lib/read-model/upsert-facts';
import { normalizeHotRowFromDb } from '@/lib/read-model/audit/compare-hot';
import type { AuditOptions, FactsAuditSummary } from '@/lib/read-model/audit/types';
import type { FactCounts, FactKey } from '@/lib/read-model/types';

const FACT_COUNT_COLUMNS = [
  'total',
  'solved',
  'cancelled',
  'open_count',
  'tech_solved',
  'deployment_total',
  'deployment_done',
  'installation_total',
  'installation_done',
] as const satisfies readonly (keyof FactCounts)[];

function emptyFactsSummary(): FactsAuditSummary {
  return {
    keys_checked: 0,
    missing_in_postgres: 0,
    extra_in_postgres: 0,
    column_mismatch_keys: 0,
    column_mismatches: 0,
  };
}

async function loadPostgresFacts(client: pg.PoolClient, yearStart: string) {
  const res = await client.query(
    `
    SELECT fact_date::text AS fact_date, office_id, call_type, account, region,
           total, solved, cancelled, open_count, tech_solved,
           deployment_total, deployment_done, installation_total, installation_done
    FROM call_metrics_daily
    WHERE fact_date >= $1::date
    `,
    [yearStart]
  );
  return res.rows;
}

async function computeExpectedFacts(
  client: pg.PoolClient,
  yearStart: string,
  onProgress?: (message: string) => void
) {
  const pageSize = 10000;
  const map = new Map<string, FactKey & FactCounts>();
  const hotColumns = `
    vtrnno, ncancelreason, logged_at, nofficeid, call_type, account, region, status_bucket
  `;

  let lastTrn = '';
  let totalRows = 0;
  for (;;) {
    const res = await client.query(
      `
      SELECT ${hotColumns}
      FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz
        AND ($2::text = '' OR vtrnno > $2)
      ORDER BY vtrnno
      LIMIT $3
      `,
      [`${yearStart}T00:00:00`, lastTrn, pageSize]
    );
    if (!res.rows.length) break;
    totalRows += res.rows.length;

    const hotRows = res.rows
      .map((row) => normalizeHotRowFromDb(row as Record<string, unknown>))
      .filter((row) =>
        isSummaryEligibleCall({
          vtrnno: row.vtrnno,
          ncancelreason: row.ncancelreason,
        })
      );

    const pageFacts = aggregateFactCounts(hotRows);
    for (const [key, counts] of pageFacts) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...counts });
        continue;
      }
      for (const col of FACT_COUNT_COLUMNS) {
        existing[col] = (existing[col] ?? 0) + (counts[col] ?? 0);
      }
    }

    lastTrn = String(res.rows[res.rows.length - 1].vtrnno);
    onProgress?.(`Facts recompute progress: ${totalRows} hot rows scanned`);
    if (res.rows.length < pageSize) break;
  }

  onProgress?.(`Facts recompute complete: ${totalRows} hot rows → ${map.size} fact keys`);
  return map;
}

export async function auditFacts(
  client: pg.PoolClient,
  opts: Pick<AuditOptions, 'onMismatch' | 'onProgress'>
): Promise<FactsAuditSummary> {
  const yearStart = currentYearStart();
  const summary = emptyFactsSummary();
  opts.onProgress?.(`Facts audit: recomputing from hot for ${yearStart}+`);

  const expectedMap = await computeExpectedFacts(client, yearStart, opts.onProgress);
  const pgRows = await loadPostgresFacts(client, yearStart);
  const pgMap = new Map(
    pgRows.map((row) => {
      const key = serializeFactKey({
        fact_date: String(row.fact_date),
        office_id: Number(row.office_id),
        call_type: String(row.call_type),
        account: String(row.account),
        region: String(row.region),
      });
      return [key, row];
    })
  );

  summary.keys_checked = Math.max(expectedMap.size, pgMap.size);
  let compared = 0;

  for (const [key, expected] of expectedMap) {
    compared++;
    if (compared % 10000 === 0) {
      opts.onProgress?.(
        `Facts compare progress: ${compared}/${expectedMap.size} expected keys checked`
      );
    }
    const pgRow = pgMap.get(key);
    if (!pgRow) {
      summary.missing_in_postgres++;
      opts.onMismatch?.({
        phase: 'facts',
        entity: 'call_metrics_daily',
        kind: 'missing_in_hot',
        key,
        details: { expected },
      });
      continue;
    }

    const badCols: { column: string; hot_value: unknown; expected_value: unknown }[] = [];
    for (const col of FACT_COUNT_COLUMNS) {
      const hotVal = Number(pgRow[col] ?? 0);
      const expectedVal = Number(expected[col] ?? 0);
      if (hotVal !== expectedVal) {
        badCols.push({ column: col, hot_value: hotVal, expected_value: expectedVal });
      }
    }
    if (badCols.length === 0) continue;

    summary.column_mismatch_keys++;
    summary.column_mismatches += badCols.length;
    opts.onMismatch?.({
      phase: 'facts',
      entity: 'call_metrics_daily',
      kind: 'column_mismatch',
      key,
      columns: badCols,
    });
  }
  opts.onProgress?.(
    `Facts compare progress: ${compared}/${expectedMap.size} expected keys checked`
  );

  let extraScanned = 0;
  for (const key of pgMap.keys()) {
    extraScanned++;
    if (extraScanned % 10000 === 0) {
      opts.onProgress?.(`Facts extra-key scan progress: ${extraScanned}/${pgMap.size}`);
    }
    if (!expectedMap.has(key)) {
      summary.extra_in_postgres++;
      opts.onMismatch?.({
        phase: 'facts',
        entity: 'call_metrics_daily',
        kind: 'extra_in_hot',
        key,
      });
    }
  }
  opts.onProgress?.(`Facts extra-key scan progress: ${extraScanned}/${pgMap.size}`);

  opts.onProgress?.(
    `Facts audit done — keys ${summary.keys_checked}, mismatches ${summary.column_mismatch_keys}, missing ${summary.missing_in_postgres}, extra ${summary.extra_in_postgres}`
  );

  return summary;
}

export async function applyFactsAuditFixes(client: pg.PoolClient): Promise<boolean> {
  const yearStart = currentYearStart();
  await truncateCurrentYearFacts(client, yearStart);

  const expectedMap = await computeExpectedFacts(client, yearStart);
  const factRows = Array.from(expectedMap.values());
  await upsertFactRows(client, factRows);
  return true;
}
