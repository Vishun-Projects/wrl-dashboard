import { createHash } from 'crypto';
import { withClient } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import { fetchArcpIncrementalRows } from '@/modules/arcp-claims/server/sync/crm-fetch';
import {
  ARCP_ENTITY,
  bootstrapArcpWatermarksFromHot,
  getArcpSyncState,
  isArcpSyncRunning,
  markArcpSyncError,
  pollUntilArcpSyncReleased,
  tryAcquireArcpSyncLock,
  updateArcpSyncWatermarks,
} from '@/modules/arcp-claims/server/sync/lock';
import { dedupeArcpRows, maxArcpWatermarks, processArcpRows } from '@/modules/arcp-claims/server/sync/transform';
import { invalidateArcpPostgresCoverageCache } from '@/modules/arcp-claims/server/sync/coverage-query';
import { countArcpRows, upsertArcpRows } from '@/modules/arcp-claims/server/sync/upsert';
import { SYNC_WATERMARK_GUARD } from '@/lib/read-model/lock';

const OVERLAP_MS = 2 * 60 * 1000;
const SYNC_TX_LOCK_TIMEOUT_MS = Number(process.env.PG_SYNC_LOCK_TIMEOUT_MS ?? 120_000);

export type ArcpIncrementalResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  rowsUpserted: number;
  crmRowsFetched?: number;
};

function arcpSyncEnabled(): boolean {
  return process.env.SYNC_ARCP_ENABLED === 'true';
}

function parseSyncWatermark(value: unknown): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

type ArcpIncrementalPrep =
  | { kind: 'skip'; reason: string }
  | { kind: 'wait' }
  | { kind: 'proceed'; watermarkStart: Date };

async function prepareArcpIncremental(client: import('pg').PoolClient): Promise<ArcpIncrementalPrep> {
  const state = await getArcpSyncState(client);
  if (state?.status === 'pending_backfill' || state?.status === 'backfilling') {
    return { kind: 'skip', reason: `sync_state.status=${state.status}` };
  }
  const rowCount = await countArcpRows(client);
  if (rowCount === 0) return { kind: 'skip', reason: 'arcp_lines_hot is empty' };

  let edited = parseSyncWatermark(state?.last_editedon);
  if (!edited || edited < SYNC_WATERMARK_GUARD) {
    const boot = await bootstrapArcpWatermarksFromHot(client);
    if (!boot) {
      return {
        kind: 'skip',
        reason: `watermark not set (${edited?.toISOString() ?? 'null'})`,
      };
    }
    edited = boot.lastEditedon;
  }

  if (await isArcpSyncRunning(client)) return { kind: 'wait' };

  return {
    kind: 'proceed',
    watermarkStart: new Date(edited.getTime() - OVERLAP_MS),
  };
}

export async function runArcpIncrementalSync(): Promise<ArcpIncrementalResult> {
  if (!arcpSyncEnabled()) {
    return { ok: true, skipped: true, reason: 'SYNC_ARCP_ENABLED is not true', rowsUpserted: 0 };
  }

  let prep = await withClient(async (client) => {
    await import('@/modules/arcp-claims/server/sync/lock').then((m) => m.releaseStaleArcpSyncLock(client));
    return prepareArcpIncremental(client);
  });

  if (prep.kind === 'wait') {
    const released = await pollUntilArcpSyncReleased(() =>
      withClient((client) => isArcpSyncRunning(client))
    );
    if (!released) {
      return {
        ok: false,
        skipped: true,
        reason: 'timed out waiting for ARCP sync',
        rowsUpserted: 0,
      };
    }
    prep = await withClient((client) => prepareArcpIncremental(client));
  }

  if (prep.kind === 'skip') {
    console.log(`[arcp-sync] Incremental skipped — ${prep.reason}`);
    return { ok: true, skipped: true, reason: prep.reason, rowsUpserted: 0 };
  }

  if (prep.kind === 'wait') {
    return {
      ok: false,
      skipped: true,
      reason: 'ARCP sync still running after wait',
      rowsUpserted: 0,
    };
  }

  const watermarkStart = prep.watermarkStart;

  console.log(`[arcp-sync] Incremental fetch from ${watermarkStart.toISOString()}`);
  const rawRows = await fetchArcpIncrementalRows(watermarkStart, (n) => {
    console.log(`[arcp-sync] CRM returned ${n} changed ARCP rows`);
  });
  const deduped = dedupeArcpRows(rawRows);
  const hotRows = processArcpRows(deduped);

  return withClient(async (client) => {
    const acquired = await tryAcquireArcpSyncLock(client);
    if (!acquired) {
      return {
        ok: true,
        skipped: true,
        reason: 'ARCP sync lock held',
        rowsUpserted: 0,
      };
    }

    const startedAt = new Date();
    const state = await getArcpSyncState(client);
    const batch = await startIngestBatch(client, ARCP_ENTITY, watermarkStart);
    const logId = await startSyncRunLog(client, ARCP_ENTITY, batch.batchId);

    try {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL lock_timeout = '${SYNC_TX_LOCK_TIMEOUT_MS}'`);
        await client.query(
          `SET LOCAL statement_timeout = '${Number(process.env.SYNC_PG_STATEMENT_TIMEOUT_MS ?? 600_000)}'`
        );

        const rowsUpserted = await upsertArcpRows(client, hotRows);
        const watermarks = maxArcpWatermarks(deduped);
        const nextEdited =
          watermarks.lastEditedon && state?.last_editedon && watermarks.lastEditedon < state.last_editedon
            ? state.last_editedon
            : watermarks.lastEditedon ?? state?.last_editedon ?? null;
        const nextAdded =
          watermarks.lastAddedon && state?.last_addedon && watermarks.lastAddedon < state.last_addedon
            ? state.last_addedon
            : watermarks.lastAddedon ?? state?.last_addedon ?? null;

        if (deduped.length > 0) {
          await updateArcpSyncWatermarks(client, nextEdited, nextAdded, rowsUpserted);
        } else {
          // Empty but successful catch-up — advance past the scanned window so we do not re-OOM forever
          const advanced = new Date();
          const keepEdited =
            state?.last_editedon && state.last_editedon.getTime() > advanced.getTime()
              ? state.last_editedon
              : advanced;
          await updateArcpSyncWatermarks(client, keepEdited, state?.last_addedon ?? null, 0);
        }

        const checksum = createHash('sha256')
          .update(hotRows.map((r) => r.ncode).sort((a, b) => a - b).join(','))
          .digest('hex');

        await completeIngestBatch(client, batch.batchId, nextEdited, rowsUpserted, 'completed', checksum);
        await finishSyncRunLog(client, logId, 'completed', {
          startedAt,
          rowsUpserted,
          rowsDeleted: 0,
        });

        await client.query('COMMIT');
        if (rowsUpserted > 0) {
          invalidateArcpPostgresCoverageCache();
        }
        console.log(`[arcp-sync] Incremental complete — upserted ${rowsUpserted}`);
        return { ok: true, rowsUpserted, crmRowsFetched: deduped.length };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await completeIngestBatch(client, batch.batchId, null, 0, 'failed');
        await finishSyncRunLog(client, logId, 'failed', { startedAt, errorMessage: message });
      } catch {
        /* ignore cleanup errors */
      }
      await markArcpSyncError(client, message);
      throw err;
    }
  });
}
