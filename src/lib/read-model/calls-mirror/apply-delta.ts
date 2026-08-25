import { dedupeCrmRows, transformCrmRowToHot } from '@/lib/read-model/transform';
import { maxCrmWatermarks } from '@/lib/read-model/dates';
import { shouldReplaceHotFromCrm } from '@/lib/read-model/apply-crm-delta';
import type { HotRow } from '@/lib/read-model/types';
import type { SyncStateRow } from '@/lib/read-model/types';
import {
  deleteMirrorRowsByTrn,
  fetchMirrorRowsByTrn,
  upsertMirrorRows,
} from '@/lib/read-model/calls-mirror/upsert';
import { updateMirrorWatermarks } from '@/lib/read-model/calls-mirror/lock';

const SYNC_TX_LOCK_TIMEOUT_MS = Number(process.env.PG_SYNC_LOCK_TIMEOUT_MS ?? 120_000);

export type ApplyMirrorDeltaResult = {
  rowsUpserted: number;
  rowsDeleted: number;
  rowsSkippedStale: number;
  upsertedRows: HotRow[];
  nextEdited: Date | null;
  nextAdded: Date | null;
};

/**
 * Upsert every non-transfer CRM row into calls_crm_mirror (any call year / status).
 * Deletes when the row becomes a transfer or transform fails. No hot / facts / cancelled writes.
 */
export async function applyCrmRowsToMirror(
  client: import('pg').PoolClient,
  rawRows: Record<string, unknown>[],
  opts: {
    state: SyncStateRow | null;
    advanceWatermarks?: boolean;
    /** When false, leave sync_state.is_running alone (backfill holds the lock). */
    releaseLockOnWatermark?: boolean;
  }
): Promise<ApplyMirrorDeltaResult> {
  const deduped = dedupeCrmRows(rawRows);
  const { state, advanceWatermarks = true, releaseLockOnWatermark = true } = opts;
  const trns = deduped
    .map((row) => String(row.vtrnno ?? row.UniqueCallNo ?? '').trim())
    .filter(Boolean);

  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '${SYNC_TX_LOCK_TIMEOUT_MS}'`);
    await client.query(
      `SET LOCAL statement_timeout = '${Number(process.env.SYNC_PG_STATEMENT_TIMEOUT_MS ?? 600_000)}'`
    );

    const existingRows = trns.length > 0 ? await fetchMirrorRowsByTrn(client, trns) : [];
    const existingByTrn = new Map(existingRows.map((row) => [row.vtrnno, row]));

    const upsertRows: HotRow[] = [];
    const deleteTrns: string[] = [];
    let rowsSkippedStale = 0;

    for (const row of deduped) {
      const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
      if (!trn) continue;

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
    }

    if (rowsSkippedStale > 0) {
      console.log(
        `[calls-mirror] Skipped ${rowsSkippedStale} CRM row(s) older than mirror source_editedon`
      );
    }

    const rowsUpserted = await upsertMirrorRows(client, upsertRows);
    const rowsDeleted = await deleteMirrorRowsByTrn(client, deleteTrns);

    const watermarks = maxCrmWatermarks(deduped);
    const nextEdited =
      watermarks.lastEditedon && state?.last_editedon && watermarks.lastEditedon < state.last_editedon
        ? state.last_editedon
        : watermarks.lastEditedon ?? state?.last_editedon ?? null;
    const nextAdded =
      watermarks.lastAddedon && state?.last_addedon && watermarks.lastAddedon < state.last_addedon
        ? state.last_addedon
        : watermarks.lastAddedon ?? state?.last_addedon ?? null;

    if (advanceWatermarks && releaseLockOnWatermark) {
      await updateMirrorWatermarks(client, nextEdited, nextAdded, rowsUpserted, 'ok');
    }

    await client.query('COMMIT');

    return {
      rowsUpserted,
      rowsDeleted,
      rowsSkippedStale,
      upsertedRows: upsertRows,
      nextEdited,
      nextAdded,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
