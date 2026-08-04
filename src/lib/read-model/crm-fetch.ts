import { postQuery, isCrmOutOfMemoryError, isCrmSqlTimeoutError } from '@/lib/db/proxy';
import {
  buildSyncCorpusTableName,
  buildSyncFieldsSql,
  looksLikeBranchOffice,
  TRHCALLS_EXCLUDE_TRANSFERRED,
  type TrhcallsNcodeShard,
} from '@/sql/trhcalls/query';
import {
  splitDateRangeByDays,
  splitDayByHours,
  formatCrmDateTime,
  todayLocalDate,
} from '@/lib/read-model/dates';
import { formatLocalDate } from '@/lib/dates/local-date';
/** Initial ncode shards per day — lighter sync query than ARCP; default 8 (ARCP uses 16 on a simpler table). */
export const SYNC_CRM_NCODE_SHARD_INITIAL =
  Number(process.env.SYNC_CRM_NCODE_SHARD_INITIAL ?? 8) || 8;

/** Max ncode shard splits before failing a calls CRM fetch window. */
export const SYNC_CRM_NCODE_SHARD_MAX =
  Number(process.env.SYNC_CRM_NCODE_SHARD_MAX ?? 32) || 32;


const FETCH_GAP_MS = Number(process.env.SYNC_CRM_FETCH_GAP_MS ?? 1500) || 1500; // Pause between shard/chunk POSTs — shared CRM DBQUERY melts under burst.
const RETRY_DELAYS_MS = [3000, 10000, 30000];

/** Incremental date-chunk size — keep small; wide catch-up after downtime OOMs/timeouts CRM. */
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

/**
 * Backfill CRM windows — keep modest so the first attempt usually succeeds.
 * Wide windows (14d) time out on dense months and retry (extra CRM load).
 */
const SYNC_BACKFILL_CHUNK_DAYS = Math.max(
  1,
  Number(process.env.SYNC_BACKFILL_CHUNK_DAYS ?? 7) || 7
);
/** Pause between backfill chunk POSTs — CRM DBQUERY is shared / fragile under burst. */
const SYNC_BACKFILL_FETCH_GAP_MS =
  Number(process.env.SYNC_BACKFILL_FETCH_GAP_MS ?? 3000) || 3000;
const SYNC_BACKFILL_TIMEOUT_MS =
  Number(process.env.SYNC_BACKFILL_TIMEOUT_MS ?? 600_000) || 600_000;

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

export function planCrmIncrementalEditedonDelta(watermarkStart: Date): {
  watermark: string;
  catchUpDays: number;
  estimatedCrmRequests: number;
} {
  const watermark = formatCrmDateTime(watermarkStart);
  const catchUpDays = Math.max(
    0,
    Math.ceil((Date.now() - watermarkStart.getTime()) / (24 * 60 * 60 * 1000))
  );
  return {
    watermark,
    catchUpDays,
    estimatedCrmRequests: SYNC_CRM_NCODE_SHARD_INITIAL,
  };
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
  editedonStart?: string;
  editedonEnd?: string;
  ncodeShard?: TrhcallsNcodeShard | null;
};

function buildCorpusWindowTableName(opts: CorpusWindowOpts): string {
  return buildSyncCorpusTableName({
    lastSync: opts.lastSync,
    startDate: opts.startDate,
    endDate: opts.endDate,
    startDateTime: opts.startDateTime,
    endDateTime: opts.endDateTime,
    editedonStart: opts.editedonStart,
    editedonEnd: opts.editedonEnd,
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

/** OOM/timeout ladder: hour-split a single day, else binary-double ncode shards up to MAX. */
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

export async function fetchCrmIncrementalEditedonDelta(
  watermark: string,
  timeoutMs = SYNC_INCREMENTAL_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  return fetchCrmCorpusWindowResilient(
    {
      lastSync: watermark,
      orderBy: 'ISNULL(tc.editedon, tc.addedon) ASC',
      timeoutMs,
    },
    `editedon>=${watermark}`
  );
}

/** CRM rows edited on a calendar day (addedon <> editedon) — replays status changes on any logged date. */
export async function fetchCrmEditedonDayWindow(
  startDate: string,
  endDate: string,
  timeoutMs = SYNC_INCREMENTAL_TIMEOUT_MS
): Promise<Record<string, unknown>[]> {
  return fetchCrmCorpusWindowResilient(
    {
      editedonStart: startDate,
      editedonEnd: endDate,
      orderBy: 'tc.editedon ASC',
      timeoutMs,
    },
    `editedon ${startDate}..${endDate} edited-only`
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

export async function forEachCrmBackfillChunk(
  startDate: string,
  endDate: string,
  fn: (info: { chunk: string; rows: Record<string, unknown>[] }) => Promise<void>
): Promise<number> {
  const chunks = splitDateRangeByDays(startDate, endDate, SYNC_BACKFILL_CHUNK_DAYS);
  let totalFetched = 0;

  console.log(
    `[sync-worker] Backfill CRM fetch: ${chunks.length} chunk(s) × ${SYNC_BACKFILL_CHUNK_DAYS} day(s), gap ${SYNC_BACKFILL_FETCH_GAP_MS}ms`
  );

  for (const chunk of chunks) {
    const rows = await fetchCrmRangeChunkResilient(
      chunk,
      chunk.start,
      chunk.end,
      SYNC_BACKFILL_TIMEOUT_MS
    );
    totalFetched += rows.length;
    console.log(
      `[sync-worker] CRM chunk ${chunk.start}..${chunk.end} → ${rows.length} rows (${totalFetched} total)`
    );
    await fn({ chunk: `${chunk.start}..${chunk.end}`, rows });
    await sleep(SYNC_BACKFILL_FETCH_GAP_MS);
  }

  return totalFetched;
}

export async function fetchCrmRowsForBackfill(
  startDate: string,
  endDate: string,
  onProgress?: (info: { chunk: string; rows: number; total: number }) => void
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = [];

  await forEachCrmBackfillChunk(startDate, endDate, async ({ chunk, rows }) => {
    allRows.push(...rows);
    onProgress?.({ chunk, rows: rows.length, total: allRows.length });
  });

  return allRows;
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

/** Open pipeline logged >90d ago — open-old exceptions outside the rolling register window. */
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
  }  );
}

/** Latest CRM row per TRN (full sync corpus joins). */
export async function fetchCrmRowsByTrns(
  trns: string[],
  opts?: { includeTransferred?: boolean }
): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(trns.map((t) => String(t).trim()).filter(Boolean))];
  if (!unique.length) return [];

  const transferFilter = opts?.includeTransferred ? '' : TRHCALLS_EXCLUDE_TRANSFERRED;
  const merged: Record<string, unknown>[] = [];
  const chunkSize = Math.max(10, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);

  for (let i = 0; i < unique.length; i += chunkSize) {
    const batch = unique.slice(i, i + chunkSize);
    const tableName = buildSyncCorpusTableName({ vtrnnoIn: batch });
    const rows = await fetchCrmChunk({
      tableName,
      condition: `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${transferFilter}`,
      orderBy: 'tc.dtrndate ASC',
      timeoutMs: SYNC_INCREMENTAL_TIMEOUT_MS,
    });
    merged.push(...rows);
    if (i + chunkSize < unique.length) await sleep(FETCH_GAP_MS);
  }

  return merged;
}

/**
 * TRNs whose visit-fault rows changed recently (covers major/minor without trhcalls.editedon bump).
 * Uses trdcalls2fault.editedon/addedon.
 */
export async function fetchCrmTrnsWithRecentFaultEdits(
  sinceIso: string,
  limit = 500
): Promise<string[]> {
  const safeSince = sinceIso.replace(/'/g, "''");
  const top = Math.max(1, Math.min(2000, Math.trunc(limit)));
  const rawSql = `
    SELECT TOP ${top} vtrnno
    FROM (
      SELECT DISTINCT LTRIM(RTRIM(tc.vtrnno)) AS vtrnno
      FROM trdcalls2fault tf (NOLOCK)
      INNER JOIN trhcalls tc (NOLOCK)
        ON tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid
      WHERE ISNULL(tc.vtrnno, '') <> ''
        AND ISNULL(tf.editedon, tf.addedon) >= '${safeSince}'
    ) x
    ORDER BY vtrnno
  `;
  const result = await postQuery({
    rawSql,
    timeoutMs: SYNC_INCREMENTAL_TIMEOUT_MS,
  });
  return [
    ...new Set(
      ((result.data || []) as Record<string, unknown>[])
        .map((r) => String(r.vtrnno ?? '').trim())
        .filter(Boolean)
    ),
  ];
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
