import { withClient } from '@/lib/read-model/db';
import {
  fetchCrmOpenOldRows,
  fetchCrmRowsForBackfill,
} from '@/lib/read-model/crm-fetch';
import { todayLocalDate } from '@/lib/read-model/dates';
import { registerHotRetentionStart } from '@/lib/read-model/hot-window';
import {
  dedupeCrmRows,
  processCrmRows,
  processCrmRowsForYtdLoad,
} from '@/lib/read-model/transform';
import { countHotRows, upsertHotRows } from '@/lib/read-model/upsert-hot';

const DEFAULT_UPSERT_BATCH = Math.max(
  50,
  Number(process.env.SYNC_HOT_UPSERT_BATCH ?? 300) || 300
);

export type HotYtdSyncResult = {
  totalUpserted: number;
  hotCount: number;
  ytdStart: string;
  ytdEnd: string;
  janFebHotCount: number;
};

async function upsertCrmChunk(
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

/** Load calendar YTD (+ open-old) from CRM into calls_latest_hot — upsert only, no truncate. */
export async function syncHotYtdFromCrm(opts?: {
  upsertBatchSize?: number;
}): Promise<HotYtdSyncResult> {
  const batchSize = opts?.upsertBatchSize ?? DEFAULT_UPSERT_BATCH;
  const ytdStart = registerHotRetentionStart();
  const ytdEnd = todayLocalDate();
  let totalUpserted = 0;

  console.log(`[sync-worker] YTD hot sync ${ytdStart} .. ${ytdEnd}`);

  const ytdRows = await fetchCrmRowsForBackfill(ytdStart, ytdEnd);
  totalUpserted += await upsertCrmChunk(ytdRows, `ytd ${ytdStart}..${ytdEnd}`, batchSize, true);

  console.log('[sync-worker] Fetching open-old exception rows…');
  const openOldRows = await fetchCrmOpenOldRows();
  totalUpserted += await upsertCrmChunk(openOldRows, 'open-old', batchSize, false);

  const hotCount = await withClient((client) => countHotRows(client));
  const year = ytdStart.slice(0, 4);
  const janFebHotCount = await countHotInRange(`${year}-01-01`, `${year}-02-28`);

  console.log(
    `[sync-worker] YTD sync done — upserted ${totalUpserted}, hot table ${hotCount}, Jan–Feb ${janFebHotCount}`
  );

  if (janFebHotCount < 10_000) {
    console.warn(
      `[sync-worker] WARNING: Jan–Feb hot count is only ${janFebHotCount} — expected ~70k+. Check CRM connectivity or re-run backfill.`
    );
  }

  return { totalUpserted, hotCount, ytdStart, ytdEnd, janFebHotCount };
}
