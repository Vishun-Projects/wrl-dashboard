import { withClient } from '@/lib/read-model/db';
import { fetchCrmIncrementalEditedonDelta } from '@/lib/read-model/crm-fetch';
import { formatCrmDateTime } from '@/lib/read-model/dates';
import { applyCrmRowsToMirror } from '@/lib/read-model/calls-mirror/apply-delta';
import {
  getMirrorSyncState,
  markMirrorError,
  releaseMirrorLock,
  releaseStaleMirrorLock,
  tryAcquireMirrorLock,
} from '@/lib/read-model/calls-mirror/lock';
import { callsMirrorSyncEnabled } from '@/lib/read-model/calls-mirror/constants';
import { SYNC_WATERMARK_GUARD } from '@/lib/read-model/lock';

export type CallsMirrorIncrementalResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  rowsFetched?: number;
  rowsUpserted?: number;
  rowsDeleted?: number;
};

/**
 * Editedon watermark sync into calls_crm_mirror. Runs only when status=ok
 * (full backfill finished) and CALLS_MIRROR_SYNC_ENABLED is not false.
 */
export async function runCallsMirrorIncremental(): Promise<CallsMirrorIncrementalResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }
  if (!callsMirrorSyncEnabled()) {
    return { ok: true, skipped: true, reason: 'CALLS_MIRROR_SYNC_ENABLED=false' };
  }

  return withClient(async (client) => {
    await releaseStaleMirrorLock(client);
    const state = await getMirrorSyncState(client);
    if (!state) {
      return { ok: false, skipped: true, reason: 'sync_state calls_crm_mirror missing — apply schema 32' };
    }
    if (state.status !== 'ok') {
      return {
        ok: true,
        skipped: true,
        reason: `status=${state.status} — finish calls-mirror-backfill first`,
      };
    }

    const watermarkStart = state.last_editedon;
    if (!watermarkStart || watermarkStart < SYNC_WATERMARK_GUARD) {
      return {
        ok: false,
        skipped: true,
        reason: 'mirror last_editedon unset — re-run backfill to bootstrap',
      };
    }

    const acquired = await tryAcquireMirrorLock(client);
    if (!acquired) {
      return { ok: true, skipped: true, reason: 'mirror lock not acquired' };
    }

    try {
      const watermark = formatCrmDateTime(watermarkStart);
      console.log(`[calls-mirror] Incremental editedon delta from ${watermark}`);
      const rawRows = await fetchCrmIncrementalEditedonDelta(watermark);
      console.log(`[calls-mirror] CRM editedon delta: ${rawRows.length} rows`);

      const fresh = await getMirrorSyncState(client);
      const written = await applyCrmRowsToMirror(client, rawRows, {
        state: fresh,
        advanceWatermarks: true,
        releaseLockOnWatermark: true,
      });

      console.log(
        `[calls-mirror] Incremental complete — upserted ${written.rowsUpserted}, deleted ${written.rowsDeleted}`
      );
      return {
        ok: true,
        rowsFetched: rawRows.length,
        rowsUpserted: written.rowsUpserted,
        rowsDeleted: written.rowsDeleted,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markMirrorError(client, message);
      throw err;
    }
  });
}
