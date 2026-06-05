import { createHash } from 'crypto';
import { withClient } from '@/lib/read-model/db';
import type { ArcpFetchOpts } from '@/lib/arcp-claims/server/fetch';
import {
  ARCP_CHUNK_CACHE_VERSION,
  buildArcpChunkCacheKey,
  readArcpChunkRowsFromDisk,
  type ArcpChunkCacheKind,
} from '@/lib/arcp-claims/server/chunk-cache';
import {
  mergeArcpAggregateRows,
  mergeArcpDetailRows,
  planArcpSummaryDateChunks,
  resolveArcpDateFilterColumn,
  type ArcpClaimsAggregateRow,
  type ArcpClaimsDetailRow,
} from '@/lib/arcp-claims/query';

export type ArcpLoadJobStatus = 'running' | 'partial' | 'complete';
export type ArcpLoadChunkStatus = 'pending' | 'done' | 'failed';

export type ArcpLoadJobChunk = {
  chunkStart: string;
  chunkEnd: string;
  cacheKey: string;
  status: ArcpLoadChunkStatus;
  errorMessage: string | null;
};

export type ArcpLoadJobView = {
  jobId: string;
  jobKey: string;
  kind: ArcpChunkCacheKind;
  status: ArcpLoadJobStatus;
  totalChunks: number;
  doneCount: number;
  pendingCount: number;
  failedCount: number;
  chunks: ArcpLoadJobChunk[];
  filters: Record<string, unknown>;
};

const JOB_TTL_DAYS = Number(process.env.ARCP_LOAD_JOB_TTL_DAYS ?? 7) || 7;

let cachedSchemaReady: boolean | undefined;

/** True after `docs/read-model-phase1-schema/13-arcp_claims_load_jobs.sql` is applied. */
export async function arcpLoadJobsSchemaReady(): Promise<boolean> {
  if (cachedSchemaReady !== undefined) return cachedSchemaReady;
  try {
    cachedSchemaReady = await withClient(async (client) => {
      const result = await client.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'arcp_claims_load_jobs'
        ) AS exists
      `);
      return Boolean(result.rows[0]?.exists);
    });
  } catch {
    cachedSchemaReady = false;
  }
  return cachedSchemaReady;
}

export function resetArcpLoadJobsSchemaCache(): void {
  cachedSchemaReady = undefined;
}

export function isArcpLoadJobsMissingRelationError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '42P01'
  );
}

export function buildArcpLoadJobKey(opts: ArcpFetchOpts, kind: ArcpChunkCacheKind): string {
  const dateColumn = resolveArcpDateFilterColumn(opts.dateFilterColumn);
  const security = (opts.isHod ?? true) ? 'hod' : (opts.assignedOffices ?? []).join('-');
  const raw = [
    ARCP_CHUNK_CACHE_VERSION,
    kind,
    opts.startDate || 'all',
    opts.endDate || 'all',
    dateColumn,
    opts.branch || 'All',
    opts.franchisee || 'All',
    opts.callType || 'All',
    security,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

function filtersSnapshot(opts: ArcpFetchOpts): Record<string, unknown> {
  return {
    startDate: opts.startDate,
    endDate: opts.endDate,
    dateFilterColumn: resolveArcpDateFilterColumn(opts.dateFilterColumn),
    branch: opts.branch,
    franchisee: opts.franchisee,
    callType: opts.callType,
    isHod: opts.isHod ?? true,
    assignedOffices: opts.assignedOffices ?? [],
  };
}

async function purgeExpiredLoadJobs(client: import('pg').PoolClient): Promise<void> {
  await client.query(
    `
    DELETE FROM arcp_claims_load_jobs
    WHERE updated_at < now() - ($1::int || ' days')::interval
    `,
    [JOB_TTL_DAYS]
  );
}

function rowToChunk(row: Record<string, unknown>): ArcpLoadJobChunk {
  const start = row.chunk_start;
  const end = row.chunk_end;
  return {
    chunkStart:
      start instanceof Date
        ? start.toISOString().slice(0, 10)
        : String(start ?? '').slice(0, 10),
    chunkEnd:
      end instanceof Date ? end.toISOString().slice(0, 10) : String(end ?? '').slice(0, 10),
    cacheKey: String(row.cache_key ?? ''),
    status: String(row.status ?? 'pending') as ArcpLoadChunkStatus,
    errorMessage: row.error_message != null ? String(row.error_message) : null,
  };
}

function summarizeChunks(chunks: ArcpLoadJobChunk[]): Pick<
  ArcpLoadJobView,
  'doneCount' | 'pendingCount' | 'failedCount'
> {
  let doneCount = 0;
  let pendingCount = 0;
  let failedCount = 0;
  for (const c of chunks) {
    if (c.status === 'done') doneCount += 1;
    else if (c.status === 'failed') failedCount += 1;
    else pendingCount += 1;
  }
  return { doneCount, pendingCount, failedCount };
}

function deriveJobStatus(chunks: ArcpLoadJobChunk[]): ArcpLoadJobStatus {
  const { pendingCount, failedCount } = summarizeChunks(chunks);
  if (pendingCount === 0 && failedCount === 0) return 'complete';
  if (pendingCount === 0 && failedCount > 0) return 'partial';
  return 'running';
}

async function fetchJobChunks(
  client: import('pg').PoolClient,
  jobId: string
): Promise<ArcpLoadJobChunk[]> {
  const result = await client.query(
    `
    SELECT chunk_start, chunk_end, cache_key, status, error_message
    FROM arcp_claims_load_chunks
    WHERE job_id = $1::uuid
    ORDER BY chunk_start
    `,
    [jobId]
  );
  return result.rows.map(rowToChunk);
}

async function refreshJobStatus(
  client: import('pg').PoolClient,
  jobId: string,
  chunks: ArcpLoadJobChunk[]
): Promise<ArcpLoadJobStatus> {
  const status = deriveJobStatus(chunks);
  await client.query(
    `
    UPDATE arcp_claims_load_jobs
    SET status = $2, updated_at = now(), total_chunks = $3
    WHERE job_id = $1::uuid
    `,
    [jobId, status, chunks.length]
  );
  return status;
}

export async function startOrResumeLoadJob(
  userId: string,
  opts: ArcpFetchOpts,
  kind: ArcpChunkCacheKind,
  force = false
): Promise<ArcpLoadJobView | null> {
  if (!(await arcpLoadJobsSchemaReady())) return null;

  const jobKey = buildArcpLoadJobKey(opts, kind);
  const planned = planArcpSummaryDateChunks({ ...opts, crmUiFast: true });
  const filters = filtersSnapshot(opts);

  return withClient(async (client) => {
    await purgeExpiredLoadJobs(client);

    const existing = await client.query(
      `
      SELECT job_id::text AS job_id, status
      FROM arcp_claims_load_jobs
      WHERE user_id = $1::uuid AND job_key = $2 AND kind = $3
      `,
      [userId, jobKey, kind]
    );

    let jobId: string;

    if (existing.rows.length === 0) {
      const inserted = await client.query(
        `
        INSERT INTO arcp_claims_load_jobs (user_id, job_key, kind, filters, status, total_chunks)
        VALUES ($1::uuid, $2, $3, $4::jsonb, 'running', $5)
        RETURNING job_id::text AS job_id
        `,
        [userId, jobKey, kind, JSON.stringify(filters), planned.length]
      );
      jobId = String(inserted.rows[0].job_id);
    } else {
      jobId = String(existing.rows[0].job_id);
      await client.query(
        `
        UPDATE arcp_claims_load_jobs
        SET filters = $2::jsonb, updated_at = now(), status = 'running', total_chunks = $3
        WHERE job_id = $1::uuid
        `,
        [jobId, JSON.stringify(filters), planned.length]
      );
      if (force) {
        await client.query(`DELETE FROM arcp_claims_load_chunks WHERE job_id = $1::uuid`, [jobId]);
      }
    }

    for (const chunk of planned) {
      const cacheKey = buildArcpChunkCacheKey(opts, chunk, kind);
      let status: ArcpLoadChunkStatus = 'pending';
      if (!force) {
        const diskRows = await readArcpChunkRowsFromDisk(cacheKey, kind);
        if (diskRows !== null) {
          status = 'done';
        }
      }

      if (!force && existing.rows.length > 0) {
        const prev = await client.query(
          `
          SELECT status FROM arcp_claims_load_chunks
          WHERE job_id = $1::uuid AND chunk_start = $2::date AND chunk_end = $3::date
          `,
          [jobId, chunk.start, chunk.end]
        );
        if (prev.rows.length > 0) {
          const prevStatus = String(prev.rows[0].status) as ArcpLoadChunkStatus;
          if (prevStatus === 'done') status = 'done';
          else if (prevStatus === 'failed') status = 'failed';
          else if (status !== 'done') status = prevStatus;
        }
      }

      await client.query(
        `
        INSERT INTO arcp_claims_load_chunks (job_id, chunk_start, chunk_end, cache_key, status, completed_at)
        VALUES ($1::uuid, $2::date, $3::date, $4, $5, CASE WHEN $5 = 'done' THEN now() ELSE NULL END)
        ON CONFLICT (job_id, chunk_start, chunk_end) DO UPDATE SET
          cache_key = EXCLUDED.cache_key,
          status = CASE
            WHEN $6 THEN 'pending'
            WHEN EXCLUDED.status = 'done' THEN 'done'
            ELSE arcp_claims_load_chunks.status
          END,
          error_message = CASE WHEN $6 THEN NULL ELSE arcp_claims_load_chunks.error_message END,
          completed_at = CASE
            WHEN EXCLUDED.status = 'done' THEN COALESCE(arcp_claims_load_chunks.completed_at, now())
            WHEN $6 THEN NULL
            ELSE arcp_claims_load_chunks.completed_at
          END
        `,
        [jobId, chunk.start, chunk.end, cacheKey, status, force]
      );
    }

    const chunks = await fetchJobChunks(client, jobId);
    const status = await refreshJobStatus(client, jobId, chunks);
    const counts = summarizeChunks(chunks);

    return {
      jobId,
      jobKey,
      kind,
      status,
      totalChunks: chunks.length,
      chunks,
      filters,
      ...counts,
    };
  });
}

export async function getLoadJobById(
  userId: string,
  jobId: string
): Promise<ArcpLoadJobView | null> {
  if (!(await arcpLoadJobsSchemaReady())) return null;

  return withClient(async (client) => {
    const job = await client.query(
      `
      SELECT job_id::text AS job_id, job_key, kind, status, filters, total_chunks
      FROM arcp_claims_load_jobs
      WHERE job_id = $1::uuid AND user_id = $2::uuid
      `,
      [jobId, userId]
    );
    if (job.rows.length === 0) return null;

    const row = job.rows[0];
    const chunks = await fetchJobChunks(client, jobId);
    const counts = summarizeChunks(chunks);

    return {
      jobId: String(row.job_id),
      jobKey: String(row.job_key),
      kind: String(row.kind) as ArcpChunkCacheKind,
      status: String(row.status) as ArcpLoadJobStatus,
      totalChunks: Number(row.total_chunks ?? chunks.length),
      chunks,
      filters: (row.filters ?? {}) as Record<string, unknown>,
      ...counts,
    };
  });
}

export async function getLoadJobStatus(
  userId: string,
  opts: ArcpFetchOpts,
  kind: ArcpChunkCacheKind
): Promise<ArcpLoadJobView | null> {
  if (!(await arcpLoadJobsSchemaReady())) return null;

  const jobKey = buildArcpLoadJobKey(opts, kind);
  return withClient(async (client) => {
    const job = await client.query(
      `
      SELECT job_id::text AS job_id, job_key, kind, status, filters, total_chunks
      FROM arcp_claims_load_jobs
      WHERE user_id = $1::uuid AND job_key = $2 AND kind = $3
      `,
      [userId, jobKey, kind]
    );
    if (job.rows.length === 0) return null;
    const row = job.rows[0];
    const chunks = await fetchJobChunks(client, String(row.job_id));
    const counts = summarizeChunks(chunks);
    return {
      jobId: String(row.job_id),
      jobKey: String(row.job_key),
      kind: String(row.kind) as ArcpChunkCacheKind,
      status: String(row.status) as ArcpLoadJobStatus,
      totalChunks: Number(row.total_chunks ?? chunks.length),
      chunks,
      filters: (row.filters ?? {}) as Record<string, unknown>,
      ...counts,
    };
  });
}

export async function getLatestResumableLoadJob(
  userId: string,
  kind: ArcpChunkCacheKind
): Promise<ArcpLoadJobView | null> {
  if (!(await arcpLoadJobsSchemaReady())) return null;

  return withClient(async (client) => {
    const job = await client.query(
      `
      SELECT job_id::text AS job_id, job_key, kind, status, filters, total_chunks
      FROM arcp_claims_load_jobs
      WHERE user_id = $1::uuid AND kind = $2 AND status IN ('running', 'partial')
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [userId, kind]
    );
    if (job.rows.length === 0) return null;
    const row = job.rows[0];
    const chunks = await fetchJobChunks(client, String(row.job_id));
    const counts = summarizeChunks(chunks);
    return {
      jobId: String(row.job_id),
      jobKey: String(row.job_key),
      kind: String(row.kind) as ArcpChunkCacheKind,
      status: String(row.status) as ArcpLoadJobStatus,
      totalChunks: Number(row.total_chunks ?? chunks.length),
      chunks,
      filters: (row.filters ?? {}) as Record<string, unknown>,
      ...counts,
    };
  });
}

export async function markChunkDone(
  jobId: string,
  chunkStart: string,
  chunkEnd: string
): Promise<void> {
  if (!(await arcpLoadJobsSchemaReady())) return;

  await withClient(async (client) => {
    await client.query(
      `
      UPDATE arcp_claims_load_chunks
      SET status = 'done', error_message = NULL, completed_at = now()
      WHERE job_id = $1::uuid AND chunk_start = $2::date AND chunk_end = $3::date
      `,
      [jobId, chunkStart, chunkEnd]
    );
    const chunks = await fetchJobChunks(client, jobId);
    await refreshJobStatus(client, jobId, chunks);
  });
}

export async function markChunkFailed(
  jobId: string,
  chunkStart: string,
  chunkEnd: string,
  errorMessage: string
): Promise<void> {
  if (!(await arcpLoadJobsSchemaReady())) return;

  await withClient(async (client) => {
    await client.query(
      `
      UPDATE arcp_claims_load_chunks
      SET status = 'failed', error_message = $4, completed_at = NULL
      WHERE job_id = $1::uuid AND chunk_start = $2::date AND chunk_end = $3::date
      `,
      [jobId, chunkStart, chunkEnd, errorMessage.slice(0, 500)]
    );
    const chunks = await fetchJobChunks(client, jobId);
    await refreshJobStatus(client, jobId, chunks);
  });
}

export async function mergeJobAggregatesFromDisk(
  job: ArcpLoadJobView
): Promise<ArcpClaimsAggregateRow[]> {
  const parts: ArcpClaimsAggregateRow[][] = [];
  for (const chunk of job.chunks) {
    if (chunk.status !== 'done') continue;
    const rows = await readArcpChunkRowsFromDisk(chunk.cacheKey, 'agg');
    if (rows && rows.length > 0) parts.push(rows as ArcpClaimsAggregateRow[]);
  }
  return mergeArcpAggregateRows(parts.flat());
}

export async function mergeJobDetailFromDisk(
  job: ArcpLoadJobView
): Promise<ArcpClaimsDetailRow[]> {
  const byLine = new Map<string, ArcpClaimsDetailRow>();
  for (const chunk of job.chunks) {
    if (chunk.status !== 'done') continue;
    const rows = await readArcpChunkRowsFromDisk(chunk.cacheKey, 'detail');
    if (!rows) continue;
    for (const row of rows as ArcpClaimsDetailRow[]) {
      const key = `${row.ncode}|${row.vucnno}`;
      if (!byLine.has(key)) byLine.set(key, row);
    }
  }
  return mergeArcpDetailRows(Array.from(byLine.values()));
}

export async function clearArcpLoadJobs(userId?: string): Promise<number> {
  if (!(await arcpLoadJobsSchemaReady())) return 0;

  return withClient(async (client) => {
    if (userId) {
      const res = await client.query(
        `DELETE FROM arcp_claims_load_jobs WHERE user_id = $1::uuid`,
        [userId]
      );
      return res.rowCount ?? 0;
    }
    const res = await client.query(`DELETE FROM arcp_claims_load_jobs`);
    return res.rowCount ?? 0;
  });
}
