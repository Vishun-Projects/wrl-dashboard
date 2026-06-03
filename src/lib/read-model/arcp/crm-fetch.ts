import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import { splitDateRangeByDays } from '@/lib/read-model/dates';
import { formatCrmDateTime } from '@/lib/read-model/dates';

const FETCH_GAP_MS = Number(process.env.ARCP_FETCH_GAP_MS ?? 1200) || 1200;
const RETRY_DELAYS_MS = [3000, 10000, 30000];
/** Default CRM window — heavy weeks OOM at 7 days; override with ARCP_BACKFILL_CHUNK_DAYS. */
const DEFAULT_CHUNK_DAYS = Number(process.env.ARCP_BACKFILL_CHUNK_DAYS ?? 1) || 1;
const ARCP_SYNC_TIMEOUT_MS = Number(process.env.ARCP_SYNC_TIMEOUT_MS ?? 180000) || 180000;
import {
  ARCP_NCODE_SHARD_INITIAL,
  ARCP_NCODE_SHARD_MAX,
} from '@/lib/read-model/arcp/constants';

function rangeSpanDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

function isRetryableCrmError(err: unknown): boolean {
  if (isCrmOutOfMemoryError(err) || isCrmSqlTimeoutError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('socket hang up') ||
    msg.includes('network socket disconnected')
  );
}

/** Dense days (e.g. 2024-03-01) OOM on full-day SQL — shard by ncode up front during backfill. */
function shardFirstForSingleDay(): boolean {
  return process.env.ARCP_BACKFILL_SHARD_FIRST !== 'false';
}

const ARCP_SYNC_SELECT = `
SELECT
  arcp.ncode,
  arcp.vucnno,
  arcp.ncalls2fault AS calls2fault_code,
  CAST(tf.ncalls AS VARCHAR(50)) AS call_no,
  arcp.nofficeid,
  o.nunder AS office_under,
  CONVERT(varchar(30), arcp.dcalllogdatetime, 126) AS dcalllogdatetime,
  CONVERT(varchar(30), arcp.dsolveddatetime, 126) AS dsolveddatetime,
  arcp.bapproved,
  arcp.bapprovedho,
  arcp.dbmapproveddate,
  arcp.dhoapproveddate,
  CONVERT(varchar(30), arcp.dapproval1on, 126) AS dapproval1on,
  CONVERT(varchar(30), arcp.dapproval2on, 126) AS dapproval2on,
  CONVERT(varchar(30), arcp.addedon, 126) AS addedon,
  CONVERT(varchar(30), arcp.editedon, 126) AS editedon,
  arcp.ncalltype,
  arcp.nitemcategory,
  arcp.nlocalupcountry,
  arcp.ntraveltype,
  arcp.breject,
  arcp.brejectho,
  ISNULL(NULLIF(LTRIM(RTRIM(fs_ct.vdisplayvalue)), ''), CAST(arcp.ncalltype AS VARCHAR(50))) AS call_type_label,
  COALESCE(
    NULLIF(LTRIM(RTRIM(ic.vname)), ''),
    NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
  ) AS item_category_label,
  COALESCE(
    NULLIF(LTRIM(RTRIM(fs_lu.vdisplayvalue)), ''),
    CASE LTRIM(RTRIM(CAST(arcp.nlocalupcountry AS VARCHAR(20))))
      WHEN '1' THEN 'Local'
      WHEN '2' THEN 'Upcountry'
      WHEN '946' THEN 'Local'
      WHEN '947' THEN 'Upcountry'
      ELSE CAST(arcp.nlocalupcountry AS VARCHAR(50))
    END
  ) AS local_upcountry_label,
  arcp.ndistancerate,
  arcp.nchargespayable,
  arcp.nbmapprovedamt,
  arcp.nhoapprovedamt,
  arcp.napproval1amount,
  arcp.napproval2amount,
  CASE WHEN major.ncalls IS NOT NULL THEN 'Major' ELSE 'Minor' END AS major_minor
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
LEFT JOIN mstitemcategory ic (NOLOCK)
  ON CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
LEFT JOIN mstfixedselection fs_ct (NOLOCK)
  ON CAST(fs_ct.ncode AS VARCHAR(50)) = CAST(arcp.ncalltype AS VARCHAR(50))
  AND fs_ct.vfieldname = 'ncalltype'
LEFT JOIN mstfixedselection fs_lu (NOLOCK)
  ON CAST(fs_lu.ncode AS VARCHAR(50)) = CAST(arcp.nlocalupcountry AS VARCHAR(50))
  AND fs_lu.vfieldname = 'nlocalupcountry'
OUTER APPLY (
  SELECT TOP 1 tf2.ncalls
  FROM trdcalls2fault tf2 (NOLOCK)
  JOIN mstrepair rr (NOLOCK) ON tf2.nrepair = rr.ncode
  WHERE tf2.ncalls = tf.ncalls
    AND tf2.nofficeid = arcp.nofficeid
    AND rr.bmajor = 'True'
) major
`.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Avoid `target.push(...rows)` — spreads >~10k elements blow the JS call stack. */
function appendRows(
  target: Record<string, unknown>[],
  source: Record<string, unknown>[]
): void {
  for (let i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
}

function concatRows(
  left: Record<string, unknown>[],
  right: Record<string, unknown>[]
): Record<string, unknown>[] {
  const merged = new Array<Record<string, unknown>>(left.length + right.length);
  for (let i = 0; i < left.length; i++) merged[i] = left[i];
  for (let j = 0; j < right.length; j++) merged[left.length + j] = right[j];
  return merged;
}

function buildRangeCondition(startDate: string, endDate: string): string {
  const endTs = `${endDate} 23:59:59`;
  return `
arcp.nofficetype = '3'
AND arcp.dcalllogdatetime >= '${startDate}'
AND arcp.dcalllogdatetime <= '${endTs}'
`.trim();
}

function buildIncrementalCondition(watermark: Date): string {
  const wm = formatCrmDateTime(watermark).replace(/'/g, "''");
  return `
arcp.nofficetype = '3'
AND ISNULL(arcp.editedon, arcp.addedon) >= '${wm}'
`.trim();
}

async function fetchArcpRawSql(
  whereClause: string,
  timeoutMs = ARCP_SYNC_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  const rawSql = `${ARCP_SYNC_SELECT} WHERE ${whereClause}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await postQuery({ rawSql, timeoutMs });
      return (result.data ?? []) as Record<string, unknown>[];
    } catch (err) {
      lastErr = err;
      if (isCrmOutOfMemoryError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Invalid column name') && msg.includes('editedon') && attempt === 0) {
        const fallbackSql = rawSql.replace(/arcp\.editedon/g, 'arcp.addedon').replace(
          /ISNULL\(arcp\.editedon, arcp\.addedon\)/g,
          'arcp.addedon'
        );
        try {
          const result = await postQuery({ rawSql: fallbackSql, timeoutMs });
          return (result.data ?? []) as Record<string, unknown>[];
        } catch (fallbackErr) {
          lastErr = fallbackErr;
        }
      }
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchArcpRowsSharded(
  startDate: string,
  endDate: string,
  shardIndex: number,
  shardCount: number
): Promise<Record<string, unknown>[]> {
  const where = `${buildRangeCondition(startDate, endDate)} AND (arcp.ncode % ${shardCount}) = ${shardIndex}`;
  try {
    return await fetchArcpRawSql(where);
  } catch (err) {
    if (!isRetryableCrmError(err)) throw err;
    if (shardCount >= ARCP_NCODE_SHARD_MAX) {
      throw new Error(
        `[arcp-sync] CRM failed on ${startDate}..${endDate} ncode shard ${shardIndex}/${shardCount}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const doubled = shardCount * 2;
    console.log(
      `[arcp-sync] CRM load failed on ${startDate} ncode shard ${shardIndex}/${shardCount} — splitting to ${doubled} shards`
    );
    const left = await fetchArcpRowsSharded(startDate, endDate, shardIndex, doubled);
    const right = await fetchArcpRowsSharded(startDate, endDate, shardIndex + shardCount, doubled);
    return concatRows(left, right);
  }
}

async function fetchArcpRowsForDenseWindow(
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  console.log(
    `[arcp-sync] Loading ${startDate}..${endDate} via ${ARCP_NCODE_SHARD_INITIAL} ncode shards (no skip)`
  );
  const merged: Record<string, unknown>[] = [];
  for (let i = 0; i < ARCP_NCODE_SHARD_INITIAL; i++) {
    const shardRows = await fetchArcpRowsSharded(startDate, endDate, i, ARCP_NCODE_SHARD_INITIAL);
    appendRows(merged, shardRows);
    await sleep(FETCH_GAP_MS);
  }
  console.log(
    `[arcp-sync] Merged ${merged.length} CRM rows for ${startDate}..${endDate} (${ARCP_NCODE_SHARD_INITIAL} ncode shards)`
  );
  return merged;
}

/** Fetch one date window; on CRM viewstate OOM/timeout, split into smaller windows and retry. */
export async function fetchArcpRowsForWindow(
  startDate: string,
  endDate: string
): Promise<Record<string, unknown>[]> {
  const span = rangeSpanDays(startDate, endDate);

  if (span <= 1 && shardFirstForSingleDay()) {
    return fetchArcpRowsForDenseWindow(startDate, endDate);
  }

  try {
    return await fetchArcpRawSql(buildRangeCondition(startDate, endDate));
  } catch (err) {
    if (!isRetryableCrmError(err)) throw err;

    if (span <= 1) {
      return fetchArcpRowsForDenseWindow(startDate, endDate);
    }

    const nextStep = 1;
    const subChunks = splitDateRangeByDays(startDate, endDate, nextStep);
    if (subChunks.length <= 1) {
      return fetchArcpRowsForDenseWindow(startDate, endDate);
    }

    console.log(
      `[arcp-sync] CRM error on ${startDate}..${endDate} — retrying as ${subChunks.length} smaller windows (${nextStep}-day)`
    );

    const merged: Record<string, unknown>[] = [];
    for (const sub of subChunks) {
      appendRows(merged, await fetchArcpRowsForWindow(sub.start, sub.end));
      await sleep(FETCH_GAP_MS);
    }
    return merged;
  }
}

export async function fetchArcpRowsForRange(
  startDate: string,
  endDate: string,
  onProgress?: (info: { chunk: string; rows: number }) => void,
  chunkDays = DEFAULT_CHUNK_DAYS
): Promise<Record<string, unknown>[]> {
  const chunks = splitDateRangeByDays(startDate, endDate, chunkDays);
  const allRows: Record<string, unknown>[] = [];

  for (const chunk of chunks) {
    const rows = await fetchArcpRowsForWindow(chunk.start, chunk.end);
    appendRows(allRows, rows);
    onProgress?.({ chunk: `${chunk.start}..${chunk.end}`, rows: rows.length });
    await sleep(FETCH_GAP_MS);
  }

  return allRows;
}

export async function fetchArcpIncrementalRows(
  watermark: Date,
  onProgress?: (rows: number) => void
): Promise<Record<string, unknown>[]> {
  const rows = await fetchArcpRawSql(buildIncrementalCondition(watermark));
  onProgress?.(rows.length);
  return rows;
}
