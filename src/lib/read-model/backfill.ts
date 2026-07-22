import { createHash } from 'crypto';
import { withClient, withTransaction } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import { fetchCrmRowsForBackfill } from '@/lib/read-model/crm-fetch';
import { refreshDimensions } from '@/lib/read-model/dims';
import {
  currentYearStart,
  splitDateRangeByDays,
} from '@/lib/read-model/dates';
import { updateSyncWatermarks, readHotTableWatermarks } from '@/lib/read-model/lock';
import { aggregateFactCounts } from '@/lib/read-model/metrics';
import type { HotRow } from '@/lib/read-model/types';
import { dedupeCrmRows, transformCrmRowToHot } from '@/lib/read-model/transform';
import { isSummaryEligibleCall } from '@/lib/summary/derive';
import { syncHotYtdFromCrm } from '@/lib/read-model/sync-hot-ytd';
import { countHotRows, truncateHot } from '@/lib/read-model/upsert-hot';
import {
  truncateCurrentYearFacts,
  upsertFactRows,
} from '@/lib/read-model/upsert-facts';

const ENTITY = 'calls_latest_hot';

export async function runInitialBackfill(opts?: { resume?: boolean }): Promise<void> {
  const startedAt = new Date();
  const resume = opts?.resume ?? process.env.SYNC_BACKFILL_RESUME === 'true';
  console.log(`[sync-worker] Starting initial backfill${resume ? ' (resume)' : ''}…`);

  const existingHot = await withClient((client) => countHotRows(client));
  if (existingHot > 0 && !resume) {
    console.log(
      `[sync-worker] Hot table already has ${existingHot} rows. Set SYNC_BACKFILL_RESUME=true to continue without truncate.`
    );
  }

  await withTransaction(async (client) => {
    await refreshDimensions(client);
    if (!resume || existingHot === 0) {
      await truncateHot(client);
      console.log('[sync-worker] Hot table truncated');
    } else {
      console.log(`[sync-worker] Resume mode — keeping ${existingHot} existing hot rows`);
    }
    await client.query(
      `UPDATE sync_state SET status = 'backfilling', is_running = false WHERE entity = $1`,
      [ENTITY]
    );
  });

  const batch = await withClient(async (client) => {
    const b = await startIngestBatch(client, ENTITY, new Date(0));
    const logId = await startSyncRunLog(client, ENTITY, b.batchId);
    return { batchId: b.batchId, logId };
  });

  let totalUpserted = 0;

  try {
    const ytdResult = await syncHotYtdFromCrm();
    totalUpserted = ytdResult.totalUpserted;

    const hotEnd = ytdResult.ytdEnd;

    const yearStart = currentYearStart();
    console.log(`[sync-worker] Backfilling YTD facts from ${yearStart} .. ${hotEnd}`);

    await withClient(async (client) => {
      await truncateCurrentYearFacts(client, yearStart);
    });

    const factChunks = splitDateRangeByDays(yearStart, hotEnd, 14);
    const allMetricRows: HotRow[] = [];
    for (const chunk of factChunks) {
      console.log(`[sync-worker] Fetching facts chunk ${chunk.start} .. ${chunk.end}`);
      const ytdRows = await fetchCrmRowsForBackfill(chunk.start, chunk.end);
      const metricRows = dedupeCrmRows(ytdRows)
        .filter((row) => isSummaryEligibleCall(row))
        .map((row) => transformCrmRowToHot(row))
        .filter((row): row is NonNullable<typeof row> => row != null);
      allMetricRows.push(...metricRows);
    }

    const factMap = aggregateFactCounts(allMetricRows);
    const factRows = Array.from(factMap.values());
    await withClient(async (client) => {
      await upsertFactRows(client, factRows);
      await client.query(
        `UPDATE sync_state SET status = 'ok', is_running = false, last_run_at = now() WHERE entity = 'call_metrics_daily'`
      );
    });
    console.log(`[sync-worker] Upserted ${factRows.length} fact grains`);

    await withClient(async (client) => {
      const fromHot = await readHotTableWatermarks(client);
      const watermarks = {
        lastEditedon: fromHot.lastEditedon,
        lastAddedon: fromHot.lastAddedon,
      };

      await updateSyncWatermarks(client, watermarks.lastEditedon, watermarks.lastAddedon, totalUpserted);
      const hotCount = await countHotRows(client);
      const trnRes = await client.query<{ vtrnno: string }>(
        `SELECT vtrnno FROM calls_latest_hot ORDER BY vtrnno`
      );
      const checksum = createHash('sha256')
        .update(trnRes.rows.map((r) => r.vtrnno).join(','))
        .digest('hex');

      await completeIngestBatch(
        client,
        batch.batchId,
        watermarks.lastEditedon,
        totalUpserted,
        'completed',
        checksum
      );
      await finishSyncRunLog(client, batch.logId, 'completed', {
        startedAt,
        rowsUpserted: totalUpserted,
      });

      console.log(
        `[sync-worker] Backfill complete — hot rows ${hotCount}, Jan–Feb ${ytdResult.janFebHotCount}, facts ${factRows.length}, watermark ${watermarks.lastEditedon?.toISOString() ?? 'n/a'}`
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => {
      await completeIngestBatch(client, batch.batchId, null, totalUpserted, 'failed');
      await finishSyncRunLog(client, batch.logId, 'failed', { startedAt, errorMessage: message });
      await client.query(
        `UPDATE sync_state SET status = 'error', is_running = false WHERE entity = $1`,
        [ENTITY]
      );
    });
    throw err;
  }
}

export async function runDimsRefresh(): Promise<void> {
  await withTransaction(async (client) => {
    const dims = await refreshDimensions(client);
    console.log(
      `[sync-worker] Dimensions refreshed — offices ${dims.offices}, engineers ${dims.engineers}, call types ${dims.callTypes}`
    );
  });
}
