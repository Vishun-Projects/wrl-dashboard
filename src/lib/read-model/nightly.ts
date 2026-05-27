import { withTransaction } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import {
  fetchCrmOpenOldRows,
  fetchCrmRowsForRange,
} from '@/lib/read-model/crm-fetch';
import { refreshDimensions } from '@/lib/read-model/dims';
import {
  currentYearStart,
  daysAgoDate,
  todayLocalDate,
} from '@/lib/read-model/dates';
import { tryAcquireSyncLock, releaseSyncLock, markSyncError } from '@/lib/read-model/lock';
import { aggregateFactCounts } from '@/lib/read-model/metrics';
import { dedupeCrmRows, processCrmRows, transformCrmRowToHot } from '@/lib/read-model/transform';
import { isSummaryEligibleCall } from '@/lib/report-summary-derive';
import {
  countHotRows,
  deleteHotRowsByTrn,
  upsertHotRows,
} from '@/lib/read-model/upsert-hot';
import {
  truncateCurrentYearFacts,
  upsertFactRows,
} from '@/lib/read-model/upsert-facts';

const ENTITY = 'calls_latest_hot';

export async function runNightlyReconcile(): Promise<void> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    console.log('[sync-worker] SYNC_WORKER_ENABLED is not true — skipping nightly');
    return;
  }

  const startedAt = new Date();
  await withTransaction(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      console.log('[sync-worker] Another sync run is in progress — skipping nightly');
      return;
    }

    const batch = await startIngestBatch(client, ENTITY, null);
    const logId = await startSyncRunLog(client, ENTITY, batch.batchId);

    try {
      console.log('[sync-worker] Nightly reconcile — refreshing hot window from CRM');
      const hotStart = daysAgoDate(90);
      const hotEnd = todayLocalDate();
      const windowRows = await fetchCrmRowsForRange(hotStart, hotEnd);
      const openOldRows = await fetchCrmOpenOldRows();
      const combined = dedupeCrmRows([...windowRows, ...openOldRows]);
      const hotRows = processCrmRows(combined);
      const upserted = await upsertHotRows(client, hotRows);

      const crmTrns = new Set(hotRows.map((row) => row.vtrnno));
      const existing = await client.query(`SELECT vtrnno FROM calls_latest_hot`);
      const orphanTrns = existing.rows
        .map((row) => String(row.vtrnno))
        .filter((trn) => !crmTrns.has(trn));
      const deletedOrphans = await deleteHotRowsByTrn(client, orphanTrns);

      const pruneResult = await client.query(`
        DELETE FROM calls_latest_hot h
        WHERE NOT (
          h.logged_at >= now() - interval '90 days'
          OR (
            h.status_bucket IN ('open_unallocated', 'assigned', 'tech_solved')
            AND h.logged_at < now() - interval '90 days'
          )
        )
      `);
      const pruned = pruneResult.rowCount ?? 0;

      console.log('[sync-worker] Rebuilding current-year facts');
      const yearStart = currentYearStart();
      await truncateCurrentYearFacts(client, yearStart);
      const ytdRows = await fetchCrmRowsForRange(yearStart, hotEnd);
      const ytdDeduped = dedupeCrmRows(ytdRows);
      const metricRows = ytdDeduped
        .filter((row) => isSummaryEligibleCall(row))
        .map((row) => transformCrmRowToHot(row))
        .filter((row): row is NonNullable<typeof row> => row != null);
      const factRows = Array.from(aggregateFactCounts(metricRows).values());
      await upsertFactRows(client, factRows);

      console.log('[sync-worker] Refreshing dimensions');
      await refreshDimensions(client);

      await releaseSyncLock(client, 'ok', upserted);
      await completeIngestBatch(client, batch.batchId, new Date(), upserted, 'completed');
      await finishSyncRunLog(client, logId, 'completed', {
        startedAt,
        rowsUpserted: upserted,
        rowsDeleted: deletedOrphans + pruned,
      });

      const hotCount = await countHotRows(client);
      console.log(
        `[sync-worker] Nightly complete — hot ${hotCount}, upserted ${upserted}, deleted ${deletedOrphans + pruned}, facts ${factRows.length}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await completeIngestBatch(client, batch.batchId, null, 0, 'failed');
      await finishSyncRunLog(client, logId, 'failed', { startedAt, errorMessage: message });
      await markSyncError(client, message);
      throw err;
    }
  });
}
