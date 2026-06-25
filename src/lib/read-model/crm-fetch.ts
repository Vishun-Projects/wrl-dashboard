import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import {
  buildSyncCorpusTableName,
  buildSyncFieldsSql,
  looksLikeBranchOffice,
  TRHCALLS_EXCLUDE_TRANSFERRED,
  type TrhcallsNcodeShard,
} from '@/lib/trhcalls/query';
import {
  splitDateRangeByDays,
  splitDayByHours,
  formatCrmDateTime,
  todayLocalDate,
} from '@/lib/read-model/dates';
import { formatLocalDate } from '@/lib/report/filters';
import {
  SYNC_CRM_NCODE_SHARD_INITIAL,
  SYNC_CRM_NCODE_SHARD_MAX,
} from '@/lib/read-model/constants';

const FETCH_GAP_MS = Number(process.env.SYNC_CRM_FETCH_GAP_MS ?? 1500) || 1500;
const RETRY_DELAYS_MS = [3000, 10000, 30000];

/** Default CRM window for incremental catch-up (was 7 — too heavy after downtime). */
const SYNC_INCREMENTAL_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.SYNC_CRM_INCREMENTAL_CHUNK_DAYS ?? 1) || 1
);
/** Wide catch-up spans use even smaller windows. */
const SYNC_CATCHUP_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.SYNC_CRM_CATCHUP_CHUNK_DAYS ?? 1) || 1
);
const SYNC_INCREMENTAL_TIMEOUT_MS =
  Number(process.env.SYNC_CRM_INCREMENTAL_TIMEOUT_MS ?? 300_000) || 300_000;

const SYNC_EXTRA_FIELDS = `
  COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) AS latlong
`;

function syncFieldsSql(): string {
  return `${buildSyncFieldsSql().trim()},\n${SYNC_EXTRA_FIELDS.trim()}`;
}

export type CrmDateChunk = { start: string; end: string };

export type CrmIncrementalPlan = {
  watermark: string;
  startDate: string;
  endDate: string;
  catchUpDays: number;
  chunkDays: number;
  chunks: CrmDateChunk[];
  estimatedCrmRequests: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rangeSpanDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

function isRetryableCrmFetchError(err: unknown): boolean {
  return isCrmOutOfMemoryError(err) || isCrmSqlTimeoutError(err);
}

/** Single-day corpus queries (many joins + dedup) always timeout as one CRM request — shard up front like ARCP. */
function shardFirstForSingleDay(): boolean {
  return process.env.SYNC_CRM_SHARD_FIRST !== 'false';
}

function resolveIncrementalChunkDays(catchUpDays: number): number {
  if (catchUpDays <= 1) return 1;
  if (catchUpDays > 3) return SYNC_CATCHUP_CHUNK_DAYS;
  return SYNC_INCREMENTAL_CHUNK_DAYS;
}

export function planCrmIncrementalChunks(watermarkStart: Date): CrmIncrementalPlan {
  const watermark = formatCrmDateTime(watermarkStart);
  const startDate = formatLocalDate(watermarkStart);
  const endDate = todayLocalDate();
  const catchUpDays = Math.max(
    0,
    Math.ceil((Date.now() - watermarkStart.getTime()) / (24 * 60 * 60 * 1000))
  );
  const chunkDays = resolveIncrementalChunkDays(Math.max(catchUpDays, 1));
  const chunks = splitDateRangeByDays(startDate, endDate, chunkDays);
  const estimatedCrmRequests = chunks.length * SYNC_CRM_NCODE_SHARD_INITIAL;
  return { watermark, startDate, endDate, catchUpDays, chunkDays, chunks, estimatedCrmRequests };
}

type CorpusWindowOpts = {
  lastSync?: string;
  startDate?: string;
  endDate?: string;
  startDateTime?: string;
  endDateTime?: string;
  ncodeShard?: TrhcallsNcodeShard | null;
};

function buildCorpusWindowTableName(opts: CorpusWindowOpts): string {
  return buildSyncCorpusTableName({
    lastSync: opts.lastSync,
    startDate: opts.startDate,
    endDate: opts.endDate,
    startDateTime: opts.startDateTime,
    endDateTime: opts.endDateTime,
    ncodeShard: opts.ncodeShard,
  });
}

async function fetchCrmChunk(params: {
  tableName: string;
  condition: string;
  orderBy?: string;
  timeoutMs?: number;
}): Promise<Record<string, string>[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await postQuery(
        {
          fields: syncFieldsSql(),
          tableName: params.tableName,
          condition: params.condition,
          orderBy: params.orderBy ?? 'tc.dtrndate ASC',
          timeoutMs: params.timeoutMs ?? SYNC_INCREMENTAL_TIMEOUT_MS,
        },
        undefined
      );
      return (result.data ?? []) as Record<string, string>[];
    } catch (err) {
      lastErr = err;
      if (isCrmOutOfMemoryError(err)) throw err;
      if (isCrmSqlTimeoutError(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchCrmCorpusWindow(
  opts: CorpusWindowOpts & { orderBy?: string; timeoutMs: number }
): Promise<Record<string, unknown>[]> {
  const tableName = buildCorpusWindowTableName(opts);
  const condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
  return fetchCrmChunk({
    tableName,
    condition,
    orderBy: opts.orderBy,
    timeoutMs: opts.timeoutMs,
  });
}

async function fetchCrmCorpusWindowSharded(
  opts: CorpusWindowOpts & { orderBy?: string; timeoutMs: number },
  shardIndex: number,
  shardCount: number
): Promise<Record<string, unknown>[]> {
  try {
    return await fetchCrmCorpusWindow({
      ...opts,
      ncodeShard: { index: shardIndex, count: shardCount },
    });
  } catch (err) {
    if (!isRetryableCrmFetchError(err)) throw err;

    const day = opts.startDate;
    if (day && opts.endDate === day && !opts.startDateTime) {
      console.log(
        `[sync-worker] ncode shard ${shardIndex}/${shardCount} slow on ${day} — trying hour windows`
      );
      const merged: Record<string, unknown>[] = [];
      let hourFailures = 0;
      for (const hour of splitDayByHours(day)) {
        try {
          const rows = await fetchCrmCorpusWindow({
            ...opts,
            startDate: undefined,
            endDate: undefined,
            startDateTime: hour.startDateTime,
            endDateTime: hour.endDateTime,
            ncodeShard: { index: shardIndex, count: shardCount },
          });
          merged.push(...rows);
        } catch (hourErr) {
          if (!isRetryableCrmFetchError(hourErr)) throw hourErr;
          hourFailures += 1;
        }
        await sleep(FETCH_GAP_MS);
      }
      if (hourFailures > 0) {
        throw new Error(
          `[sync-worker] ${hourFailures} hour window(s) failed for ${day} on ncode shard ${shardIndex}/${shardCount}`
        );
      }
      return merged;
    }

    if (shardCount >= SYNC_CRM_NCODE_SHARD_MAX) {
      throw new Error(
        `[sync-worker] CRM failed on ${opts.startDate ?? opts.startDateTime}..${opts.endDate ?? opts.endDateTime} after ${shardCount} ncode shards: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const doubled = shardCount * 2;
    console.log(
      `[sync-worker] CRM load failed on ncode shard ${shardIndex}/${shardCount} — splitting to ${doubled} shards`
    );
    const left = await fetchCrmCorpusWindowSharded(opts, shardIndex, doubled);
    const right = await fetchCrmCorpusWindowSharded(opts, shardIndex + shardCount, doubled);
    return left.concat(right);
  }
}

async function fetchDenseDayViaNcodeShards(
  opts: CorpusWindowOpts & { orderBy?: string; timeoutMs: number },
  label: string
): Promise<Record<string, unknown>[]> {
  console.log(
    `[sync-worker] Loading ${label} via ${SYNC_CRM_NCODE_SHARD_INITIAL} ncode shards (no skip)`
  );
  const merged: Record<string, unknown>[] = [];
  for (let i = 0; i < SYNC_CRM_NCODE_SHARD_INITIAL; i++) {
    merged.push(
      ...(await fetchCrmCorpusWindowSharded(opts, i, SYNC_CRM_NCODE_SHARD_INITIAL))
    );
    await sleep(FETCH_GAP_MS);
  }
  console.log(
    `[sync-worker] Merged ${merged.length} CRM rows for ${label} (${SYNC_CRM_NCODE_SHARD_INITIAL} ncode shards)`
  );
  return merged;
}

async function fetchCrmCorpusWindowResilient(
  opts: CorpusWindowOpts & { orderBy?: string; timeoutMs: number },
  label: string
): Promise<Record<string, unknown>[]> {
  const startKey = opts.startDate ?? opts.startDateTime?.slice(0, 10) ?? '?';
  const endKey = opts.endDate ?? opts.endDateTime?.slice(0, 10) ?? '?';
  const span = rangeSpanDays(startKey, endKey);

  if (span <= 1 && !opts.startDateTime && shardFirstForSingleDay()) {
    return fetchDenseDayViaNcodeShards(opts, label);
  }

  try {
    return await fetchCrmCorpusWindow(opts);
  } catch (err) {
    if (!isRetryableCrmFetchError(err)) throw err;

    if (span <= 1 && !opts.startDateTime) {
      const hourWindows = splitDayByHours(startKey);
      if (hourWindows.length > 1) {
        console.log(
          `[sync-worker] CRM timeout on ${label} — retrying as ${hourWindows.length} hour window(s)`
        );
        const merged: Record<string, unknown>[] = [];
        for (const hour of hourWindows) {
          merged.push(
            ...(await fetchCrmCorpusWindowResilient(
              {
                ...opts,
                startDate: undefined,
                endDate: undefined,
                startDateTime: hour.startDateTime,
                endDateTime: hour.endDateTime,
              },
              `${hour.startDateTime}..${hour.endDateTime}`
            ))
          );
          await sleep(FETCH_GAP_MS);
        }
        return merged;
      }
    }

    if (span <= 1) {
      return fetchDenseDayViaNcodeShards(opts, label);
    }

    const nextStep = span <= 3 ? 1 : Math.max(1, Math.ceil(span / 2));
    const subChunks = splitDateRangeByDays(startKey, endKey, nextStep);
    if (subChunks.length <= 1) {
      return fetchDenseDayViaNcodeShards(opts, label);
    }

    console.log(
      `[sync-worker] CRM timeout on ${label} — retrying as ${subChunks.length} smaller window(s) (${nextStep}-day)`
    );

    const merged: Record<string, unknown>[] = [];
    for (const sub of subChunks) {
      merged.push(
        ...(await fetchCrmCorpusWindowResilient(
          {
            ...opts,
            startDate: sub.start,
            endDate: sub.end,
            startDateTime: undefined,
            endDateTime: undefined,
          },
          `${sub.start}..${sub.end}`
        ))
      );
      await sleep(FETCH_GAP_MS);
    }
    return merged;
  }
}

async function fetchCrmRangeChunkResilient(
  chunk: CrmDateChunk,
  rangeStart: string,
  rangeEnd: string,
  timeoutMs: number
): Promise<Record<string, unknown>[]> {
  return fetchCrmCorpusWindowResilient(
    {
      startDate: chunk.start,
      endDate: chunk.end,
      timeoutMs,
    },
    `${chunk.start}..${chunk.end}`
  );
}

export async function fetchCrmIncrementalChunk(
  watermark: string,
  chunk: CrmDateChunk,
  timeoutMs = SYNC_INCREMENTAL_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  return fetchCrmCorpusWindowResilient(
    {
      lastSync: watermark,
      startDate: chunk.start,
      endDate: chunk.end,
      orderBy: 'ISNULL(tc.editedon, tc.addedon) ASC',
      timeoutMs,
    },
    `${chunk.start}..${chunk.end}`
  );
}

export async function fetchCrmRowsForRange(
  startDate: string,
  endDate: string,
  onProgress?: (info: { chunk: string; rows: number }) => void
): Promise<Record<string, unknown>[]> {
  const catchUpDays = rangeSpanDays(startDate, endDate);
  const chunkDays = resolveIncrementalChunkDays(catchUpDays);
  const chunks = splitDateRangeByDays(startDate, endDate, chunkDays);
  const allRows: Record<string, unknown>[] = [];

  for (const chunk of chunks) {
    const rows = await fetchCrmRangeChunkResilient(
      chunk,
      startDate,
      endDate,
      SYNC_INCREMENTAL_TIMEOUT_MS
    );
    allRows.push(...rows);
    onProgress?.({ chunk: `${chunk.start}..${chunk.end}`, rows: rows.length });
    await sleep(FETCH_GAP_MS);
  }

  return allRows;
}

export async function fetchCrmIncrementalRows(
  watermarkStart: Date,
  onProgress?: (info: { chunk: string; rows: number; total: number }) => void
): Promise<Record<string, unknown>[]> {
  const plan = planCrmIncrementalChunks(watermarkStart);
  const allRows: Record<string, unknown>[] = [];

  if (plan.catchUpDays > 1) {
    console.log(
      `[sync-worker] CRM catch-up mode: ~${plan.catchUpDays} day(s), ${plan.chunks.length} chunk(s) (${plan.chunkDays}-day windows, ${plan.startDate}..${plan.endDate})`
    );
    console.log(
      `[sync-worker] CRM load estimate: ~${plan.estimatedCrmRequests} sequential DBQUERY requests (${SYNC_CRM_NCODE_SHARD_INITIAL} shards/day, ${FETCH_GAP_MS}ms gap, lightweight sync query)`
    );
  }

  for (const chunk of plan.chunks) {
    const rows = await fetchCrmIncrementalChunk(plan.watermark, chunk);
    allRows.push(...rows);
    onProgress?.({
      chunk: `${chunk.start}..${chunk.end}`,
      rows: rows.length,
      total: allRows.length,
    });
    await sleep(FETCH_GAP_MS);
  }

  return allRows;
}

/** Open calls logged more than 90 days ago (~1,801 TRNs). */
export async function fetchCrmOpenOldRows(): Promise<Record<string, unknown>[]> {
  const tableName = `
    (
      SELECT *
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
            ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
          ) AS rn
        FROM trhcalls (NOLOCK)
        WHERE dtrndate < DATEADD(day, -90, GETDATE())
          AND ISNULL(bsolved, 0) = 0
          AND ISNULL(bfastclose, 0) = 0
          AND (ncancelreason IS NULL OR ncancelreason = 0)
          AND vtrnno IS NOT NULL AND vtrnno <> ''
          AND ISNULL(vtransfercallno, '') = ''
          AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2
      ) s
      WHERE s.rn = 1
    ) tc
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
    LEFT JOIN mstzones z (NOLOCK) ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
    LEFT JOIN (
      SELECT nofficeid, COUNT(DISTINCT ncode) AS branch_headcount
      FROM mstusers (NOLOCK)
      WHERE bactive = 'True'
      GROUP BY nofficeid
    ) hc ON o.ncode = hc.nofficeid
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
    LEFT JOIN (
      SELECT DISTINCT tf.ncalls, tf.nofficeid
      FROM trdcalls2fault tf (NOLOCK)
      INNER JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode
      WHERE r.bmajor = 'True'
    ) sync_major ON sync_major.ncalls = tc.ncode AND sync_major.nofficeid = tc.nofficeid
  `;

  return fetchCrmChunk({
    tableName,
    condition: '1=1',
    orderBy: 'tc.dtrndate ASC',
    timeoutMs: SYNC_INCREMENTAL_TIMEOUT_MS,
  });
}

export async function fetchDimOffices(): Promise<Record<string, string>[]> {
  return fetchDimQuery({
    fields: 'ncode, vcompanyname, nunder, nzone',
    tableName: 'mstoffice (NOLOCK)',
    condition: '1=1',
    orderBy: 'ncode ASC',
  });
}

export async function fetchDimEngineers(): Promise<Record<string, string>[]> {
  return fetchDimQuery({
    fields: 'ncode, vname, nofficeid',
    tableName: 'mstusers (NOLOCK)',
    condition: "bactive = 'True'",
    orderBy: 'vname ASC',
  });
}

export async function fetchDimCallTypes(): Promise<Record<string, string>[]> {
  return fetchDimQuery({
    fields: 'ncode, vdisplayvalue',
    tableName: 'mstfixedselection (NOLOCK)',
    condition: "vfieldname = 'ncalltype'",
    orderBy: 'vdisplayvalue ASC',
  });
}

async function fetchDimQuery(params: {
  fields: string;
  tableName: string;
  condition: string;
  orderBy: string;
}): Promise<Record<string, string>[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await postQuery({
        fields: params.fields,
        tableName: params.tableName,
        condition: params.condition,
        orderBy: params.orderBy,
      });
      return (result.data ?? []) as Record<string, string>[];
    } catch (err) {
      lastErr = err;
      if (isCrmOutOfMemoryError(err) || isCrmSqlTimeoutError(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export { looksLikeBranchOffice };
