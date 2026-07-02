import type pg from 'pg';
import {
  fetchCrmOpenOldRows,
  fetchCrmRowsForBackfill,
} from '@/lib/read-model/crm-fetch';
import { todayLocalDate } from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { processCrmRows, processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import type { AuditOptions, ReverseAuditSummary } from '@/lib/read-model/audit/types';

/** Reverse TRN set diff: CRM-eligible TRNs vs calls_latest_hot. */
export async function auditHotReverse(
  client: pg.PoolClient,
  opts: Pick<AuditOptions, 'onMismatch' | 'onProgress'>
): Promise<ReverseAuditSummary> {
  const ytdStart = registerHotRetentionStart();
  const ytdEnd = todayLocalDate();
  opts.onProgress?.(`Reverse audit: fetching CRM YTD ${ytdStart}..${ytdEnd}`);

  const ytdCrmRows = await fetchCrmRowsForBackfill(ytdStart, ytdEnd);
  const ytdHot = processCrmRowsForYtdLoad(ytdCrmRows);
  const ytdTrns = new Set(ytdHot.map((r) => r.vtrnno));

  opts.onProgress?.('Reverse audit: fetching CRM open-old rows');
  const openOldRows = await fetchCrmOpenOldRows();
  const openHot = processCrmRows(openOldRows);
  const openOldTrns = new Set(openHot.map((r) => r.vtrnno));

  const expectedHotTrns = new Set([...ytdTrns, ...openOldTrns]);

  const hotRes = await client.query<{ vtrnno: string; logged_at: Date }>(
    `SELECT vtrnno, logged_at FROM calls_latest_hot`
  );
  const hotTrns = new Set(hotRes.rows.map((r) => String(r.vtrnno).trim()));
  const ytdStartTs = new Date(`${ytdStart}T00:00:00`).getTime();

  let in_crm_not_in_hot = 0;
  for (const trn of expectedHotTrns) {
    if (!hotTrns.has(trn)) {
      in_crm_not_in_hot++;
      if (in_crm_not_in_hot <= 50) {
        opts.onMismatch?.({
          phase: 'reverse',
          entity: 'calls_latest_hot',
          kind: 'missing_in_hot',
          key: trn,
          trn,
        });
      }
    }
  }

  let in_hot_not_eligible = 0;
  for (const row of hotRes.rows) {
    const trn = String(row.vtrnno).trim();
    if (expectedHotTrns.has(trn)) continue;
    const loggedAt = row.logged_at instanceof Date ? row.logged_at : new Date(String(row.logged_at));
    if (loggedAt.getTime() < ytdStartTs) continue;
    in_hot_not_eligible++;
    if (in_hot_not_eligible <= 50) {
      opts.onMismatch?.({
        phase: 'reverse',
        entity: 'calls_latest_hot',
        kind: 'extra_in_hot',
        key: trn,
        trn,
      });
    }
  }

  opts.onProgress?.(
    `Reverse audit done — expected ${expectedHotTrns.size}, hot ${hotTrns.size}, missing ${in_crm_not_in_hot}, extra YTD ${in_hot_not_eligible}`
  );

  return {
    crm_eligible_count: expectedHotTrns.size,
    hot_count: hotTrns.size,
    in_crm_not_in_hot,
    in_hot_not_eligible,
  };
}
