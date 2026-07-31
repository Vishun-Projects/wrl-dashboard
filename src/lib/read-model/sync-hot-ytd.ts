import { withClient } from '@/lib/read-model/db';
import {
  fetchCrmOpenOldRows,
  fetchCrmRowsForBackfill,
  forEachCrmBackfillChunk,
} from '@/lib/read-model/crm-fetch';
import { todayLocalDate } from '@/lib/read-model/dates';
import { dayBeforeDate, registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { processCrmRows, processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import { countHotRows, upsertHotRows } from '@/lib/read-model/upsert-hot';

const DEFAULT_UPSERT_BATCH = Math.max(
  50,
  Number(process.env.SYNC_HOT_UPSERT_BATCH ?? 300) || 300
);

export type HotRangeSyncResult = {
  totalUpserted: number;
  totalFetched: number;
  hotCount: number;
  startDate: string;
  endDate: string;
  rangeHotCount: number;
};

async function upsertCrmRows(
  rows: Record<string, unknown>[],
  label: string,
  batchSize: number,
  useYtdLoad: boolean
): Promise<number> {
  const hotRows = useYtdLoad ? processCrmRowsForYtdLoad(rows) : processCrmRows(rows);
  if (hotRows.length === 0) return 0;
  await withClient(async (client) => {
    await upsertHotRows(client, hotRows, batchSize);
  });
  console.log(`[sync-worker] Upserted ${hotRows.length} hot rows (${label})`);
  return hotRows.length;
}

async function countHotInRange(startDate: string, endDate: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM calls_latest_hot
      WHERE logged_at >= $1::timestamptz
        AND logged_at <= $2::timestamptz
      `,
      [`${startDate}T00:00:00`, `${endDate}T23:59:59`]
    );
    return res.rows[0]?.count ?? 0;
  });
}

/** Upsert CRM rows for a date range — no truncate. Streams chunk-by-chunk by default. */
export async function syncHotDateRangeFromCrm(opts: {
  startDate: string;
  endDate: string;
  label?: string;
  upsertBatchSize?: number;
  /** When true, fetch each CRM chunk then upsert immediately (safe for large ranges). */
  streamChunks?: boolean;
}): Promise<HotRangeSyncResult> {
  const batchSize = opts.upsertBatchSize ?? DEFAULT_UPSERT_BATCH;
  const label = opts.label ?? `${opts.startDate}..${opts.endDate}`;
  const streamChunks = opts.streamChunks !== false;
  let totalUpserted = 0;
  let totalFetched = 0;

  console.log(`[sync-worker] Hot range sync ${label} (stream=${streamChunks})`);

  if (streamChunks) {
    totalFetched = await forEachCrmBackfillChunk(
      opts.startDate,
      opts.endDate,
      async ({ chunk, rows }) => {
        totalUpserted += await upsertCrmRows(rows, chunk, batchSize, true);
      }
    );
  } else {
    const rows = await fetchCrmRowsForBackfill(opts.startDate, opts.endDate);
    totalFetched = rows.length;
    totalUpserted += await upsertCrmRows(rows, label, batchSize, true);
  }

  const hotCount = await withClient((client) => countHotRows(client));
  const rangeHotCount = await countHotInRange(opts.startDate, opts.endDate);

  console.log(
    `[sync-worker] Range sync done (${label}) — fetched ${totalFetched}, upserted ${totalUpserted}, in-range hot ${rangeHotCount}, table total ${hotCount}`
  );

  return {
    totalUpserted,
    totalFetched,
    hotCount,
    startDate: opts.startDate,
    endDate: opts.endDate,
    rangeHotCount,
  };
}

export type HotYtdSyncResult = HotRangeSyncResult & {
  ytdStart: string;
  ytdEnd: string;
  janFebHotCount: number;
};

/** Load calendar YTD (+ open-old) from CRM into calls_latest_hot — upsert only, no truncate. */
export async function syncHotYtdFromCrm(opts?: {
  upsertBatchSize?: number;
}): Promise<HotYtdSyncResult> {
  const ytdStart = registerHotRetentionStart();
  const ytdEnd = todayLocalDate();

  const ytdResult = await syncHotDateRangeFromCrm({
    startDate: ytdStart,
    endDate: ytdEnd,
    label: `ytd ${ytdStart}..${ytdEnd}`,
    upsertBatchSize: opts?.upsertBatchSize,
    streamChunks: true,
  });

  console.log('[sync-worker] Fetching open-old exception rows…');
  const openOldRows = await fetchCrmOpenOldRows();
  const openUpserted = await upsertCrmRows(
    openOldRows,
    'open-old',
    opts?.upsertBatchSize ?? DEFAULT_UPSERT_BATCH,
    false
  );

  const hotCount = await withClient((client) => countHotRows(client));
  const year = ytdStart.slice(0, 4);
  const janFebHotCount = await countHotInRange(`${year}-01-01`, `${year}-02-28`);
  const totalUpserted = ytdResult.totalUpserted + openUpserted;

  console.log(
    `[sync-worker] YTD sync done — upserted ${totalUpserted}, hot table ${hotCount}, Jan–Feb ${janFebHotCount}`
  );

  if (janFebHotCount < 10_000) {
    console.warn(
      `[sync-worker] WARNING: Jan–Feb hot count is only ${janFebHotCount} — expected ~70k+. Check CRM connectivity or re-run backfill.`
    );
  }

  return {
    ...ytdResult,
    totalUpserted,
    hotCount,
    ytdStart,
    ytdEnd,
    janFebHotCount,
  };
}

/** Upsert YTD + open-old from CRM — no truncate (safe gap-fill after initial backfill). */
export async function runFillYtdHot(): Promise<void> {
  console.log('[sync-worker] fill-ytd — upsert only, no truncate');
  await syncHotYtdFromCrm();
}

const DEFAULT_HISTORICAL_START = '2020-01-01';

export function resolvePreYtdHistoricalRange(): {
  startDate: string;
  endDate: string;
} | null {
  const ytdStart = registerHotRetentionStart();
  const endDate = dayBeforeDate(ytdStart);
  const startDate =
    process.env.SYNC_HISTORICAL_START_DATE?.trim() ||
    process.env.SYNC_PRE_YTD_START_DATE?.trim() ||
    DEFAULT_HISTORICAL_START;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(
      `Invalid SYNC_HISTORICAL_START_DATE "${startDate}" — use YYYY-MM-DD (e.g. 2020-01-01)`
    );
  }

  if (startDate > endDate) {
    return null;
  }

  return { startDate, endDate };
}

/**
 * Upsert pre–calendar-YTD calls from CRM (e.g. 2020-01-01 .. 2025-12-31).
 * No truncate — existing rows are kept; same TRN is updated on conflict.
 */
export async function runBackfillHistoricalHot(): Promise<void> {
  const range = resolvePreYtdHistoricalRange();
  if (!range) {
    const ytdStart = registerHotRetentionStart();
    console.log(
      `[sync-worker] backfill-historical skipped — start date is after YTD boundary (${ytdStart})`
    );
    return;
  }

  console.log(
    `[sync-worker] backfill-historical — upsert only, no truncate (${range.startDate} .. ${range.endDate})`
  );

  await syncHotDateRangeFromCrm({
    startDate: range.startDate,
    endDate: range.endDate,
    label: `historical ${range.startDate}..${range.endDate}`,
    streamChunks: true,
  });
}
