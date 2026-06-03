import { createHash } from 'crypto';
import { withClient, withTransaction } from '@/lib/read-model/db';
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
  splitDateRangeByDays,
  todayLocalDate,
  maxCrmWatermarks,
  parseCrmDate,
} from '@/lib/read-model/dates';
import { updateSyncWatermarks, readHotTableWatermarks } from '@/lib/read-model/lock';
import { aggregateFactCounts } from '@/lib/read-model/metrics';
import type { HotRow } from '@/lib/read-model/types';
import { dedupeCrmRows, processCrmRows, transformCrmRowToHot } from '@/lib/read-model/transform';
import { isSummaryEligibleCall } from '@/lib/report/summary-derive';
import { countHotRows, truncateHot, upsertHotRows } from '@/lib/read-model/upsert-hot';
import {
  truncateCurrentYearFacts,
  upsertFactRows,
} from '@/lib/read-model/upsert-facts';

const ENTITY = 'calls_latest_hot';
const HOT_CHUNK_DAYS = 7;

async function upsertHotChunk(rows: Record<string, unknown>[], label: string): Promise<number> {
  const hotRows = processCrmRows(dedupeCrmRows(rows));
  if (hotRows.length === 0) return 0;
  await withClient(async (client) => {
    await upsertHotRows(client, hotRows, 50);
  });
  console.log(`[sync-worker] Upserted ${hotRows.length} hot rows (${label})`);
  return hotRows.length;
}

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
  const allRawRows: Record<string, unknown>[] = [];

  try {
    const hotStart = daysAgoDate(90);
    const hotEnd = todayLocalDate();
    console.log(`[sync-worker] Backfilling hot window ${hotStart} .. ${hotEnd}`);

    const chunks = splitDateRangeByDays(hotStart, hotEnd, HOT_CHUNK_DAYS);
    for (const chunk of chunks) {
      console.log(`[sync-worker] Fetching hot chunk ${chunk.start} .. ${chunk.end}`);
      const rows = await fetchCrmRowsForRange(chunk.start, chunk.end);
      allRawRows.push(...rows);
      totalUpserted += await upsertHotChunk(rows, `${chunk.start}..${chunk.end}`);
    }

    console.log('[sync-worker] Fetching open-old exception rows…');
    const openOldRows = await fetchCrmOpenOldRows();
    allRawRows.push(...openOldRows);
    totalUpserted += await upsertHotChunk(openOldRows, 'open-old');

    const yearStart = currentYearStart();
    console.log(`[sync-worker] Backfilling YTD facts from ${yearStart} .. ${hotEnd}`);

    await withClient(async (client) => {
      await truncateCurrentYearFacts(client, yearStart);
    });

    const factChunks = splitDateRangeByDays(yearStart, hotEnd, 14);
    const allMetricRows: HotRow[] = [];
    for (const chunk of factChunks) {
      console.log(`[sync-worker] Fetching facts chunk ${chunk.start} .. ${chunk.end}`);
      const ytdRows = await fetchCrmRowsForRange(chunk.start, chunk.end);
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
    });
    console.log(`[sync-worker] Upserted ${factRows.length} fact grains`);

    const combined = dedupeCrmRows(allRawRows);
    let watermarks = maxCrmWatermarks(combined);

    await withClient(async (client) => {
      if (!watermarks.lastEditedon) {
        const fromHot = await readHotTableWatermarks(client);
        watermarks = {
          lastEditedon: fromHot.lastEditedon,
          lastAddedon: fromHot.lastAddedon ?? watermarks.lastAddedon,
        };
      }

      await updateSyncWatermarks(client, watermarks.lastEditedon, watermarks.lastAddedon, totalUpserted);
      const hotCount = await countHotRows(client);
      const checksum = createHash('sha256')
        .update(
          processCrmRows(combined)
            .map((r) => r.vtrnno)
            .sort()
            .join(',')
        )
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
        `[sync-worker] Backfill complete — hot rows ${hotCount}, facts ${factRows.length}, watermark ${watermarks.lastEditedon?.toISOString() ?? 'n/a'}`
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => {
      await completeIngestBatch(client, batch.batchId, null, totalUpserted, 'failed');
      await finishSyncRunLog(client, batch.logId, 'failed', { startedAt, errorMessage: message });
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
