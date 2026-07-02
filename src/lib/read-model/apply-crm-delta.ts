import {
  buildNetFactDeltas,
} from '@/lib/read-model/metrics';
import { applyNetFactDeltas } from '@/lib/read-model/upsert-facts';
import {
  dedupeCrmRows,
  isHotEligibleRow,
  transformCrmRowToHot,
} from '@/lib/read-model/transform';
import { maxCrmWatermarks } from '@/lib/read-model/dates';
import {
  deleteHotRowsByTrn,
  fetchHotRowsByTrn,
  upsertHotRows,
} from '@/lib/read-model/upsert-hot';
import { updateSyncWatermarks } from '@/lib/read-model/lock';
import type { HotRow } from '@/lib/read-model/types';
import type { getSyncState } from '@/lib/read-model/lock';

const SYNC_TX_LOCK_TIMEOUT_MS = Number(process.env.PG_SYNC_LOCK_TIMEOUT_MS ?? 120_000);

/**
 * When CRM editedon (or addedon for new calls) is at least as fresh as hot, replace the
 * whole row — not a partial status patch. Skips only strictly older CRM snapshots
 * (overlap-window duplicates).
 */
export function shouldReplaceHotFromCrm(
  existing: HotRow | undefined,
  incoming: HotRow
): boolean {
  if (!existing) return true;
  const existingTs = existing.source_editedon?.getTime() ?? 0;
  const incomingTs = incoming.source_editedon?.getTime() ?? 0;
  return incomingTs >= existingTs;
}

export type ApplyCrmDeltaResult = {
  rowsUpserted: number;
  rowsDeleted: number;
  rowsSkippedStale?: number;
  nextEdited: Date | null;
  nextAdded: Date | null;
};

/** Upsert CRM rows into hot + fact deltas; optionally advance sync watermarks. */
export async function applyCrmRowsToHot(
  client: import('pg').PoolClient,
  rawRows: Record<string, unknown>[],
  opts: {
    state: Awaited<ReturnType<typeof getSyncState>>;
    advanceWatermarks?: boolean;
  }
): Promise<ApplyCrmDeltaResult> {
  const deduped = dedupeCrmRows(rawRows);
  const { state, advanceWatermarks = true } = opts;
  const trns = deduped
    .map((row) => String(row.vtrnno ?? row.UniqueCallNo ?? '').trim())
    .filter(Boolean);

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '${SYNC_TX_LOCK_TIMEOUT_MS}'`);
    await client.query(
      `SET LOCAL statement_timeout = '${Number(process.env.SYNC_PG_STATEMENT_TIMEOUT_MS ?? 600_000)}'`
    );

    const existingHot = trns.length > 0 ? await fetchHotRowsByTrn(client, trns) : [];
    const existingByTrn = new Map(existingHot.map((row) => [row.vtrnno, row]));

    const upsertRows: HotRow[] = [];
    const deleteTrns: string[] = [];
    let rowsSkippedStale = 0;

    for (const row of deduped) {
      const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
      if (!trn) continue;
      if (isHotEligibleRow(row)) {
        const hot = transformCrmRowToHot(row);
        if (hot) {
          const existing = existingByTrn.get(trn);
          if (shouldReplaceHotFromCrm(existing, hot)) {
            upsertRows.push(hot);
          } else {
            rowsSkippedStale += 1;
          }
        } else if (existingByTrn.has(trn)) {
          deleteTrns.push(trn);
        }
      } else if (existingByTrn.has(trn)) {
        deleteTrns.push(trn);
      }
    }

    if (rowsSkippedStale > 0) {
      console.log(
        `[sync-worker] Skipped ${rowsSkippedStale} CRM row(s) older than hot source_editedon (overlap duplicate)`
      );
    }

    const rowsUpserted = await upsertHotRows(client, upsertRows);
    const rowsDeleted = await deleteHotRowsByTrn(client, deleteTrns);

    const oldFactRows: HotRow[] = [];
    const newFactRows: HotRow[] = [];
    for (const row of upsertRows) {
      const old = existingByTrn.get(row.vtrnno);
      if (old) oldFactRows.push(old);
      newFactRows.push(row);
    }
    for (const trn of deleteTrns) {
      const old = existingByTrn.get(trn);
      if (old) oldFactRows.push(old);
    }

    const netFacts = buildNetFactDeltas(oldFactRows, newFactRows);
    await applyNetFactDeltas(client, netFacts);

    const watermarks = maxCrmWatermarks(deduped);
    let nextEdited =
      watermarks.lastEditedon && state?.last_editedon && watermarks.lastEditedon < state.last_editedon
        ? state.last_editedon
        : watermarks.lastEditedon ?? state?.last_editedon ?? null;
    let nextAdded =
      watermarks.lastAddedon && state?.last_addedon && watermarks.lastAddedon < state.last_addedon
        ? state.last_addedon
        : watermarks.lastAddedon ?? state?.last_addedon ?? null;

    if (advanceWatermarks) {
      await updateSyncWatermarks(client, nextEdited, nextAdded, rowsUpserted);
    }

    await client.query('COMMIT');

    return { rowsUpserted, rowsDeleted, rowsSkippedStale, nextEdited, nextAdded };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
