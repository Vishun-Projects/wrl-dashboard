import { dayBeforeDate, registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { syncHotDateRangeFromCrm } from '@/lib/read-model/sync-hot-ytd';

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
