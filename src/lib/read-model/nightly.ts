import { withAppClient } from '@/lib/read-model/db';
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
import { refreshCrmMasters } from '@/lib/read-model/crm-masters';
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
import { runArcpRateCardSync } from '@/modules/arcp-provision/server/sync/rate-card';
import { runTransactionEntryIncremental } from '@/lib/read-model/transaction-entry';
import { runAthenaFailedCallsSync } from '@/modules/athena-reconciliation/server/sync';
import { runAttendanceDetailsSync } from '@/modules/attendance/server/sync';
import { runUserLocationsSync } from '@/modules/attendance/server/sync/user-locations';

const ENTITY = 'calls_latest_hot';

export async function runNightlyReconcile(): Promise<void> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    console.log('[sync-worker] SYNC_WORKER_ENABLED is not true — skipping nightly');
    return;
  }

  const startedAt = new Date();
  await withAppClient(async (client) => {
    const acquired = await tryAcquireSyncLock(client);
    if (!acquired) {
      console.log('[sync-worker] Another sync run is in progress — skipping nightly');
      return;
    }

    const batch = await startIngestBatch(client, ENTITY, null);
    const logId = await startSyncRunLog(client, ENTITY, batch.batchId);
    let upserted = 0;
    let deletedOrphans = 0;
    let factCount = 0;

    try {
      console.log('[sync-worker] Nightly reconcile — fetching CRM records outside DB transaction');
      const hotStart = registerHotRetentionStart();
      const hotEnd = todayLocalDate();
      const windowRows = await fetchCrmRowsForBackfill(hotStart, hotEnd);
      const openOldRows = await fetchCrmOpenOldRows();
      const ytdHot = processCrmRowsForYtdLoad(windowRows);
      const openHot = processCrmRows(openOldRows);
      const byTrn = new Map(ytdHot.map((r) => [r.vtrnno, r]));
      for (const row of openHot) byTrn.set(row.vtrnno, row);
      const hotRows = Array.from(byTrn.values());

      const yearStart = hotStart;
      const ytdRows = await fetchCrmRowsForRange(yearStart, hotEnd);
      const ytdDeduped = dedupeCrmRows(ytdRows);
      const metricRows = ytdDeduped
        .filter((row) => isSummaryEligibleCall(row))
        .map((row) => transformCrmRowToHot(row))
        .filter((row): row is NonNullable<typeof row> => row != null);
      const factRows = Array.from(aggregateFactCounts(metricRows).values());
      factCount = factRows.length;

      console.log('[sync-worker] Applying nightly updates in atomic database transaction');
      await client.query('BEGIN');
      try {
        upserted = await upsertHotRows(client, hotRows);

        const crmTrns = new Set(hotRows.map((row) => row.vtrnno));
        const existingYtd = await client.query<{ vtrnno: string }>(
          `SELECT vtrnno FROM calls_latest_hot WHERE logged_at >= $1::timestamptz`,
          [`${hotStart}T00:00:00`]
        );
        const orphanTrns = existingYtd.rows
          .map((row) => String(row.vtrnno))
          .filter((trn) => !crmTrns.has(trn));
        // YTD-only orphan delete: CRM refresh set is source of truth for current-year TRNs; leave pre-YTD alone.
        deletedOrphans = await deleteHotRowsByTrn(client, orphanTrns);

        await truncateCurrentYearFacts(client, yearStart);
        await upsertFactRows(client, factRows);
        await refreshDimensions(client);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      }

      await releaseSyncLock(client, 'ok', upserted);
      await completeIngestBatch(client, batch.batchId, new Date(), upserted, 'completed');
      await finishSyncRunLog(client, logId, 'completed', {
        startedAt,
        rowsUpserted: upserted,
        rowsDeleted: deletedOrphans,
      });

      const hotCount = await countHotRows(client);
      console.log(
        `[sync-worker] Nightly complete — hot ${hotCount}, upserted ${upserted}, deleted ${deletedOrphans}, facts ${factCount}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client.query('ROLLBACK').catch(() => {});
      await completeIngestBatch(client, batch.batchId, null, 0, 'failed').catch(() => {});
      await finishSyncRunLog(client, logId, 'failed', { startedAt, errorMessage: message }).catch(() => {});
      await markSyncError(client, message).catch(() => {});
      throw err;
    } finally {
      // Ensure advisory lock is released even if an unhandled failure occurred
      await client.query(`SELECT pg_advisory_unlock(hashtext('read_model_sync'))`).catch(() => {});
    }
  });

  // Masters rarely change — refresh outside the calls lock so report lookups stay local.
  if (process.env.SYNC_CRM_MASTERS_ENABLED !== 'false') {
    try {
      const masters = await refreshCrmMasters();
      console.log(
        `[crm-masters] Nightly sync — categories ${masters.categories}, repairs ${masters.repairs}, items ${masters.items}`
      );
    } catch (err) {
      console.error(
        '[crm-masters] Nightly sync failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

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
      const rateCard = await runArcpRateCardSync();
      if (!rateCard.skipped) {
        console.log(`[arcp-rate-card] Nightly sync — ${rateCard.rowsUpserted} rows`);
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

  if (process.env.SYNC_ATHENA_RECONCILIATION_ENABLED !== 'false') {
    try {
      const athena = await runAthenaFailedCallsSync();
      if (athena.ok) {
        console.log(
          `[athena-sync] Nightly complete — fetched ${athena.crmRowsFetched} CRM rows, ingested ${athena.newRawIngested} new`
        );
      } else {
        console.error(`[athena-sync] Nightly sync failed: ${athena.errorMessage}`);
      }
    } catch (err) {
      console.error(
        '[athena-sync] Nightly failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (process.env.SYNC_ATTENDANCE_DETAILS_ENABLED !== 'false') {
    try {
      const attendance = await runAttendanceDetailsSync();
      if (attendance.skipped) {
        console.log(`[attendance] Nightly skipped — ${attendance.reason}`);
      } else {
        console.log(
          `[attendance] Nightly complete — fetched ${attendance.fetched}, upserted ${attendance.upserted} (${attendance.dateFrom} .. ${attendance.dateTo})`
        );
      }
    } catch (err) {
      console.error(
        '[attendance] Nightly failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (process.env.SYNC_USER_LOCATIONS_ENABLED !== 'false') {
    try {
      const locations = await runUserLocationsSync();
      console.log(
        `[user-locations] Nightly complete — fetched ${locations.fetched}, upserted ${locations.upserted} (${locations.dateFrom} .. ${locations.dateTo})`
      );
    } catch (err) {
      console.error(
        '[user-locations] Nightly failed:',
        err instanceof Error ? err.message : err
      );
    }
  }
}
