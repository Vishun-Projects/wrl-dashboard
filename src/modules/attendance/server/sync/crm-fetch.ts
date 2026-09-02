import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import { formatLocalDate } from '@/lib/dates/local-date';
import { splitDateRangeByDays } from '@/lib/read-model/dates';
import { mapCrmAttendanceRow, type AttendanceDetailRow } from './map';

import { sleep } from '@/lib/utils/async';
const CRM_TIMEOUT_MS = Number(process.env.ATTENDANCE_CRM_TIMEOUT_MS ?? 180_000) || 180_000;
const FETCH_GAP_MS = Number(process.env.ATTENDANCE_FETCH_GAP_MS ?? 800) || 800;
const CHUNK_DAYS = Math.max(1, Number(process.env.ATTENDANCE_CHUNK_DAYS ?? 1) || 1);


export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

function buildSelect(from: string, toExclusive: string): string {
  return `
    SELECT *
    FROM uv_rptattandenceDetails_New2
    WHERE activitydate >= '${from}'
      AND activitydate < '${toExclusive}'
  `;
}

async function fetchWindow(from: string, toExclusive: string): Promise<AttendanceDetailRow[]> {
  const result = await postQuery({
    rawSql: buildSelect(from, toExclusive),
    timeoutMs: CRM_TIMEOUT_MS,
  });
  const raw = (result.data || []) as Record<string, unknown>[];
  const out: AttendanceDetailRow[] = [];
  for (const row of raw) {
    const mapped = mapCrmAttendanceRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function fetchWindowWithSplit(from: string, toExclusive: string): Promise<AttendanceDetailRow[]> {
  try {
    return await fetchWindow(from, toExclusive);
  } catch (err) {
    if (!isCrmOutOfMemoryError(err) && !isCrmSqlTimeoutError(err)) throw err;
    const to = addDays(toExclusive, -1);
    const midDays = Math.max(1, Math.floor((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000 / 2));
    if (from >= to) throw err;
    const mid = addDays(from, Math.max(1, midDays));
    if (mid <= from || mid >= toExclusive) throw err;
    console.warn(`[attendance] CRM OOM/timeout ${from}..${toExclusive} — splitting at ${mid}`);
    const left = await fetchWindowWithSplit(from, mid);
    await sleep(FETCH_GAP_MS);
    const right = await fetchWindowWithSplit(mid, toExclusive);
    return left.concat(right);
  }
}

export async function fetchCrmAttendanceDetails(
  dateFrom: string,
  dateTo: string
): Promise<AttendanceDetailRow[]> {
  const chunks = splitDateRangeByDays(dateFrom, dateTo, CHUNK_DAYS);
  const all: AttendanceDetailRow[] = [];
  for (const chunk of chunks) {
    const toExclusive = addDays(chunk.end, 1);
    console.log(`[attendance] CRM fetch ${chunk.start} .. ${chunk.end}`);
    const rows = await fetchWindowWithSplit(chunk.start, toExclusive);
    console.log(`[attendance] ${chunk.start} .. ${chunk.end}: ${rows.length} row(s)`);
    all.push(...rows);
    await sleep(FETCH_GAP_MS);
  }
  return all;
}
