import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withClient } from '@/lib/read-model/db';
import { getSyncState, tryAcquireSyncLock, releaseSyncLock } from '@/lib/read-model/lock';
import { applyCrmRowsToHot } from '@/lib/read-model/apply-crm-delta';

export type PriorityRefreshResult =
  | { kind: 'empty' }
  | { kind: 'coalesced' }
  | { kind: 'ok'; rowsUpserted: number; rowsFetched: number };

/** Dedupe + trim TRNs for a priority CRM→hot refresh. */
export function normalizePriorityTrns(trns: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of trns) {
    const t = String(raw ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Immediate CRM→hot patch for specific TRNs (no watermark advance).
 * If another sync holds the lock, returns coalesced — next sync will catch up.
 */
export async function priorityRefreshHotFromCrm(trns: string[]): Promise<PriorityRefreshResult> {
  const list = normalizePriorityTrns(trns);
  if (!list.length) return { kind: 'empty' };

  const crmRows = await fetchCrmRowsByTrns(list, { includeTransferred: true });
  if (!crmRows.length) {
    console.warn(
      `[sync-worker] priority-refresh: no CRM rows for ${list.length} TRN(s) (${list.slice(0, 5).join(',')}${list.length > 5 ? '…' : ''})`
    );
    return { kind: 'empty' };
  }

  return withClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      console.warn(
        `[sync-worker] priority-refresh: lock coalesced — skip ${list.length} TRN(s)`
      );
      return { kind: 'coalesced' as const };
    }
    try {
      const state = await getSyncState(client);
      const applied = await applyCrmRowsToHot(client, crmRows, {
        state,
        advanceWatermarks: false,
      });
      await releaseSyncLock(client, 'ok', applied.rowsUpserted);
      console.log(
        `[sync-worker] priority-refresh: upserted ${applied.rowsUpserted}/${crmRows.length} CRM row(s) for ${list.length} TRN(s)`
      );
      return {
        kind: 'ok' as const,
        rowsUpserted: applied.rowsUpserted,
        rowsFetched: crmRows.length,
      };
    } catch (err) {
      await releaseSyncLock(client, 'error', 0);
      throw err;
    }
  });
}
