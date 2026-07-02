import type pg from 'pg';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';
import { getSyncState } from '@/lib/read-model/lock';
import { repairHotCancelFromNcrReason } from '@/lib/read-model/repair-hot-cancel';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import { deleteHotRowsByTrn } from '@/lib/read-model/upsert-hot';
import { diffHotRow, normalizeHotRowFromDb } from '@/lib/read-model/audit/compare-hot';
import type { AuditOptions, HotAuditSummary } from '@/lib/read-model/audit/types';

const DEFAULT_PAGE_SIZE = Math.max(100, Number(process.env.AUDIT_HOT_PAGE_SIZE ?? 500) || 500);
const DEFAULT_TRN_CHUNK = Math.max(
  10,
  Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40
);

export type HotAuditResult = {
  summary: HotAuditSummary;
  staleCrmRows: Record<string, unknown>[];
  deleteTrns: string[];
};

function emptyHotSummary(): HotAuditSummary {
  return {
    rows_checked: 0,
    column_mismatch_rows: 0,
    column_mismatches: 0,
    missing_in_crm: 0,
    should_not_exist: 0,
    by_column: {},
  };
}

async function listHotTrns(
  client: pg.PoolClient,
  resumeFromTrn?: string
): Promise<string[]> {
  const res = resumeFromTrn
    ? await client.query<{ vtrnno: string }>(
        `SELECT vtrnno FROM calls_latest_hot WHERE vtrnno >= $1 ORDER BY vtrnno`,
        [resumeFromTrn]
      )
    : await client.query<{ vtrnno: string }>(
        `SELECT vtrnno FROM calls_latest_hot ORDER BY vtrnno`
      );
  return res.rows.map((r) => String(r.vtrnno).trim());
}

async function fetchHotPage(
  client: pg.PoolClient,
  trns: string[]
): Promise<Record<string, unknown>[]> {
  if (!trns.length) return [];
  const res = await client.query(`SELECT * FROM calls_latest_hot WHERE vtrnno = ANY($1::text[])`, [
    trns,
  ]);
  const byTrn = new Map(
    res.rows.map((row) => [String(row.vtrnno).trim(), row as Record<string, unknown>])
  );
  return trns.map((trn) => byTrn.get(trn)).filter(Boolean) as Record<string, unknown>[];
}

/** Forward scan: every calls_latest_hot row vs live CRM (full column diff). */
export async function auditHotForward(
  client: pg.PoolClient,
  opts: Pick<AuditOptions, 'resumeFromTrn' | 'hotPageSize' | 'crmTrnChunk' | 'onMismatch' | 'onProgress'>
): Promise<HotAuditResult> {
  const pageSize = opts.hotPageSize ?? DEFAULT_PAGE_SIZE;
  const trnChunk = opts.crmTrnChunk ?? DEFAULT_TRN_CHUNK;
  const summary = emptyHotSummary();
  const staleCrmRows: Record<string, unknown>[] = [];
  const deleteTrns: string[] = [];
  const staleTrnSet = new Set<string>();

  const allTrns = await listHotTrns(client, opts.resumeFromTrn);
  summary.rows_checked = allTrns.length;
  opts.onProgress?.(`Hot forward audit: ${allTrns.length} TRN(s) to check`);

  for (let pageStart = 0; pageStart < allTrns.length; pageStart += pageSize) {
    const pageTrns = allTrns.slice(pageStart, pageStart + pageSize);
    const hotRows = await fetchHotPage(client, pageTrns);

    for (let i = 0; i < pageTrns.length; i += trnChunk) {
      const chunkTrns = pageTrns.slice(i, i + trnChunk);
      let crmRows: Record<string, unknown>[] = [];
      try {
        crmRows = await fetchCrmRowsByTrns(chunkTrns);
      } catch (err) {
        opts.onProgress?.(
          `CRM fetch failed for batch starting ${chunkTrns[0]}: ${err instanceof Error ? err.message : err}`
        );
        continue;
      }

      const crmByTrn = new Map(
        crmRows.map((row) => [String(row.vtrnno ?? row.UniqueCallNo ?? '').trim(), row])
      );

      for (const trn of chunkTrns) {
        const hotRaw = hotRows.find((r) => String(r.vtrnno).trim() === trn);
        if (!hotRaw) continue;
        const hot = normalizeHotRowFromDb(hotRaw);
        const crm = crmByTrn.get(trn);

        if (!crm) {
          summary.missing_in_crm++;
          opts.onMismatch?.({
            phase: 'hot',
            entity: 'calls_latest_hot',
            kind: 'missing_in_crm',
            key: trn,
            trn,
          });
          continue;
        }

        const expected = transformCrmRowToHot(crm);
        if (!expected) {
          summary.should_not_exist++;
          deleteTrns.push(trn);
          opts.onMismatch?.({
            phase: 'hot',
            entity: 'calls_latest_hot',
            kind: 'should_not_exist_in_hot',
            key: trn,
            trn,
          });
          continue;
        }

        const columnMismatches = diffHotRow(hot, expected);
        if (columnMismatches.length === 0) continue;

        summary.column_mismatch_rows++;
        summary.column_mismatches += columnMismatches.length;
        for (const col of columnMismatches) {
          summary.by_column[col.column] = (summary.by_column[col.column] ?? 0) + 1;
        }

        if (!staleTrnSet.has(trn)) {
          staleTrnSet.add(trn);
          staleCrmRows.push(crm);
        }

        opts.onMismatch?.({
          phase: 'hot',
          entity: 'calls_latest_hot',
          kind: 'column_mismatch',
          key: trn,
          trn,
          columns: columnMismatches,
        });
      }
    }

    const done = Math.min(pageStart + pageSize, allTrns.length);
    if (done % (pageSize * 4) === 0 || done === allTrns.length) {
      opts.onProgress?.(
        `Hot forward progress: ${done}/${allTrns.length} — mismatches ${summary.column_mismatch_rows + summary.missing_in_crm + summary.should_not_exist}`
      );
    }
  }

  return { summary, staleCrmRows, deleteTrns };
}

export async function applyHotAuditFixes(
  client: pg.PoolClient,
  fixes: {
    staleCrmRows: Record<string, unknown>[];
    deleteTrns: string[];
  }
): Promise<{ hot_upserted: number; hot_deleted: number; ncr_repaired: number }> {
  const ncr_repaired = await repairHotCancelFromNcrReason(client);
  const state = await getSyncState(client);

  let hot_upserted = 0;
  let hot_deleted = 0;

  if (fixes.staleCrmRows.length > 0) {
    const batchSize = 200;
    for (let i = 0; i < fixes.staleCrmRows.length; i += batchSize) {
      const batch = fixes.staleCrmRows.slice(i, i + batchSize);
      const result = await applyCrmRowsToHot(client, batch, {
        state,
        advanceWatermarks: false,
      });
      hot_upserted += result.rowsUpserted;
      hot_deleted += result.rowsDeleted;
    }
  }

  if (fixes.deleteTrns.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < fixes.deleteTrns.length; i += chunkSize) {
      hot_deleted += await deleteHotRowsByTrn(client, fixes.deleteTrns.slice(i, i + chunkSize));
    }
  }

  return { hot_upserted, hot_deleted, ncr_repaired };
}
