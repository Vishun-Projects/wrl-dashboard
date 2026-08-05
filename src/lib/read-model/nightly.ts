import { withTransaction } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import {
  fetchCrmOpenOldRows,
  fetchCrmRowsForBackfill,
  fetchCrmRowsForRange,
} from '@/lib/read-model/crm-fetch';
import { refreshDimensions } from '@/lib/read-model/dims';
import {
  todayLocalDate,
} from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { tryAcquireSyncLock, releaseSyncLock, markSyncError } from '@/lib/read-model/lock';
import { aggregateFactCounts } from '@/lib/read-model/metrics';
import { dedupeCrmRows, processCrmRows, processCrmRowsForYtdLoad, transformCrmRowToHot } from '@/lib/read-model/transform';
import { isSummaryEligibleCall } from '@/lib/summary/derive';
import {
  countHotRows,
  deleteHotRowsByTrn,
  upsertHotRows,
} from '@/lib/read-model/upsert-hot';
import {
  truncateCurrentYearFacts,
  upsertFactRows,
} from '@/lib/read-model/upsert-facts';
import { runArcpIncrementalSync } from '@/modules/arcp-claims/server/sync/incremental';
import { runBackfillArcpBmApproved } from '@/modules/arcp-claims/server/sync/backfill-arcp-bm-approved';
import { runArcpApprovalRescan } from '@/modules/arcp-claims/server/sync/approval-rescan';
import { runTransactionEntryIncremental } from '@/lib/read-model/transaction-entry';

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
      console.log('[sync-worker] Nightly reconcile — refreshing hot table from CRM');
      const hotStart = registerHotRetentionStart();
      const hotEnd = todayLocalDate();
      const windowRows = await fetchCrmRowsForBackfill(hotStart, hotEnd);
      const openOldRows = await fetchCrmOpenOldRows();
      const ytdHot = processCrmRowsForYtdLoad(windowRows);
      const openHot = processCrmRows(openOldRows);
      const byTrn = new Map(ytdHot.map((r) => [r.vtrnno, r]));
      for (const row of openHot) byTrn.set(row.vtrnno, row);
      const hotRows = Array.from(byTrn.values());
      const upserted = await upsertHotRows(client, hotRows);

      const crmTrns = new Set(hotRows.map((row) => row.vtrnno));
      const existingYtd = await client.query<{ vtrnno: string }>(
        `SELECT vtrnno FROM calls_latest_hot WHERE logged_at >= $1::timestamptz`,
        [`${hotStart}T00:00:00`]
      );
      const orphanTrns = existingYtd.rows
        .map((row) => String(row.vtrnno))
        .filter((trn) => !crmTrns.has(trn));
      // YTD-only orphan delete: CRM refresh set is source of truth for current-year TRNs; leave pre-YTD alone.
      const deletedOrphans = await deleteHotRowsByTrn(client, orphanTrns);

      console.log('[sync-worker] Rebuilding current-year facts');
      const yearStart = hotStart;
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
        rowsDeleted: deletedOrphans,
      });

      const hotCount = await countHotRows(client);
      console.log(
        `[sync-worker] Nightly complete — hot ${hotCount}, upserted ${upserted}, deleted ${deletedOrphans}, facts ${factRows.length}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await completeIngestBatch(client, batch.batchId, null, 0, 'failed');
      await finishSyncRunLog(client, logId, 'failed', { startedAt, errorMessage: message });
      await markSyncError(client, message);
      throw err;
    }
  });

  if (process.env.SYNC_ARCP_ENABLED === 'true') {
    try {
      const arcp = await runArcpIncrementalSync();
      if (arcp.skipped) {
        console.log(`[arcp-sync] Nightly incremental skipped — ${arcp.reason ?? 'no changes'}`);
      } else {
        console.log(
          `[arcp-sync] Nightly incremental complete — upserted ${arcp.rowsUpserted}, CRM rows ${arcp.crmRowsFetched ?? 0}`
        );
      }
      const bmResult = await runBackfillArcpBmApproved({ onlyMissing: true });
      console.log(`[arcp-sync] arcp_bm_approved_at refresh: ${bmResult.rowsUpdated} rows`);

      // Re-scan last N days by call-log date to catch approvals where CRM
      // updated dbmapproveddate without touching editedon (incremental misses these).
      if (process.env.ARCP_APPROVAL_RESCAN_NIGHTLY !== 'false') {
        const rescan = await runArcpApprovalRescan();
        console.log(
          `[arcp-approval-rescan] Nightly rescan — ${rescan.rowsUpserted} rows upserted across ${rescan.chunksProcessed} chunks`
        );
      }
    } catch (err) {
      console.error(
        '[arcp-sync] Nightly incremental failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (process.env.SYNC_TRANSACTION_ENTRY_ENABLED !== 'false') {
    try {
      const te = await runTransactionEntryIncremental();
      if (te.skipped) {
        console.log(`[transaction-entry] Nightly skipped — ${te.reason}`);
      } else {
        console.log(`[transaction-entry] Nightly complete — upserted ${te.rowsUpserted}`);
      }
    } catch (err) {
      console.error(
        '[transaction-entry] Nightly failed:',
        err instanceof Error ? err.message : err
      );
    }
  }
}
