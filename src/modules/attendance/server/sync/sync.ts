import type pg from 'pg';
import { withClient } from '@/lib/read-model/db';
import { formatLocalDate } from '@/lib/dates/local-date';
import { todayLocalDate, splitDateRangeByDays } from '@/lib/read-model/dates';
import { fetchCrmAttendanceDetails } from './crm-fetch';
import { upsertAttendanceDetails } from './upsert';

export const ATTENDANCE_ENTITY = 'crm_attendance_details';

export type AttendanceSyncResult = {
  ok: boolean;
  dateFrom: string;
  dateTo: string;
  fetched: number;
  upserted: number;
  skipped?: boolean;
  reason?: string;
};

function defaultStart(): string {
  return process.env.ATTENDANCE_START_DATE?.trim() || `${new Date().getFullYear()}-01-01`;
}

async function readWatermark(): Promise<Date | null> {
  return withClient(async (client) => {
    const res = await client.query<{ last_addedon: Date | null }>(
      `SELECT last_addedon FROM sync_state WHERE entity = $1`,
      [ATTENDANCE_ENTITY]
    );
    return res.rows[0]?.last_addedon ?? null;
  });
}

async function markOk(watermark: Date, rowsUpserted: number): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `UPDATE sync_state
       SET status = 'ok',
           is_running = false,
           last_run_at = now(),
           last_addedon = GREATEST(COALESCE(last_addedon, '-infinity'::timestamptz), $2),
           rows_upserted_last = $3
       WHERE entity = $1`,
      [ATTENDANCE_ENTITY, watermark, rowsUpserted]
    );
  });
}

export async function runAttendanceDetailsSync(opts?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<AttendanceSyncResult> {
  const dateTo = opts?.dateTo ?? todayLocalDate();
  let dateFrom = opts?.dateFrom;
  if (!dateFrom) {
    const watermark = await readWatermark();
    if (watermark && watermark.getTime() > Date.parse('1971-01-01')) {
      const overlap = new Date(watermark);
      overlap.setDate(overlap.getDate() - 2);
      dateFrom = formatLocalDate(overlap);
    } else {
      dateFrom = defaultStart();
    }
  }

  console.log(`[attendance] sync ${dateFrom} .. ${dateTo}`);
  const chunks = splitDateRangeByDays(dateFrom, dateTo, 1);
  let fetched = 0;
  let upserted = 0;

  for (const chunk of chunks) {
    const rows = await fetchCrmAttendanceDetails(chunk.start, chunk.end);
    fetched += rows.length;
    const wrote = await withClient((client: pg.PoolClient) =>
      upsertAttendanceDetails(client, rows)
    );
    upserted += wrote;
    const chunkEnd = new Date(`${chunk.end}T23:59:59`);
    await markOk(chunkEnd, wrote);
  }

  return { ok: true, dateFrom, dateTo, fetched, upserted };
}
