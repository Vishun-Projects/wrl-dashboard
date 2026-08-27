import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import { formatLocalDate } from '@/lib/dates/local-date';
import { splitDateRangeByDays } from '@/lib/read-model/dates';
import { mapCrmUserLocationRow, type UserLocationRow } from './map';

const CRM_TIMEOUT_MS = Number(process.env.USER_LOCATION_CRM_TIMEOUT_MS ?? 180_000) || 180_000;
const FETCH_GAP_MS = Number(process.env.USER_LOCATION_FETCH_GAP_MS ?? 800) || 800;
const CHUNK_DAYS = Math.max(1, Number(process.env.USER_LOCATION_CHUNK_DAYS ?? 1) || 1);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

function buildSelect(from: string, toExclusive: string): string {
  return `
    SELECT ncode, nuser, nofficeid, vlatlong, addedon, acode, ACTION_TYPE, Distance,
           ncodetrn, vtrnno, vcustomername, vtravelmode
    FROM msduserlocation (NOLOCK)
    WHERE addedon >= '${from}'
      AND addedon < '${toExclusive}'
  `;
}

async function fetchWindow(from: string, toExclusive: string): Promise<UserLocationRow[]> {
  const result = await postQuery({
    rawSql: buildSelect(from, toExclusive),
    timeoutMs: CRM_TIMEOUT_MS,
  });
  const raw = (result.data || []) as Record<string, unknown>[];
  const out: UserLocationRow[] = [];
  for (const row of raw) {
    const mapped = mapCrmUserLocationRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function fetchWindowWithSplit(from: string, toExclusive: string): Promise<UserLocationRow[]> {
  try {
    return await fetchWindow(from, toExclusive);
  } catch (err) {
    if (!isCrmOutOfMemoryError(err) && !isCrmSqlTimeoutError(err)) throw err;
    const to = addDays(toExclusive, -1);
    const midDays = Math.max(
      1,
      Math.floor((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86400000 / 2)
    );
    if (from >= to) throw err;
    const mid = addDays(from, Math.max(1, midDays));
    if (mid <= from || mid >= toExclusive) throw err;
    console.warn(`[user-locations] CRM OOM/timeout ${from}..${toExclusive} — splitting at ${mid}`);
    const left = await fetchWindowWithSplit(from, mid);
    await sleep(FETCH_GAP_MS);
    const right = await fetchWindowWithSplit(mid, toExclusive);
    return left.concat(right);
  }
}

export async function fetchCrmUserLocations(
  dateFrom: string,
  dateTo: string
): Promise<UserLocationRow[]> {
  const chunks = splitDateRangeByDays(dateFrom, dateTo, CHUNK_DAYS);
  const all: UserLocationRow[] = [];
  for (const chunk of chunks) {
    const toExclusive = addDays(chunk.end, 1);
    console.log(`[user-locations] CRM fetch ${chunk.start} .. ${chunk.end}`);
    const rows = await fetchWindowWithSplit(chunk.start, toExclusive);
    console.log(`[user-locations] ${chunk.start} .. ${chunk.end}: ${rows.length} row(s)`);
    all.push(...rows);
    await sleep(FETCH_GAP_MS);
  }
  return all;
}
