import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import type { MisEmailSendResult } from '@/features/mis-email/services/compose-digest';
import type { MisEmailTimingReport } from '@/features/mis-email/services/timing';

export type MisEmailSendJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type MisEmailSendJob = {
  id: string;
  userId: string;
  status: MisEmailSendJobStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  sent?: Array<Omit<MisEmailSendResult, 'timing'>>;
  error?: string;
  durationMs?: number;
  timing?: MisEmailTimingReport;
};

const JOB_TTL_MS = 30 * 60 * 1000;

type DbMisEmailSendJobRow = {
  job_id: string;
  user_id: string;
  status: MisEmailSendJobStatus;
  message: string;
  sent: unknown;
  error_message: string | null;
  duration_ms: number | null;
  timing: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

let schemaReady: boolean | undefined;
const memoryJobs = new Map<string, MisEmailSendJob>();
const activeJobByUser = new Map<string, string>();

function rowToJob(row: DbMisEmailSendJobRow): MisEmailSendJob {
  return {
    id: row.job_id,
    userId: row.user_id,
    status: row.status,
    message: row.message,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    sent: Array.isArray(row.sent) ? (row.sent as Array<Omit<MisEmailSendResult, 'timing'>>) : undefined,
    error: row.error_message ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    timing: (row.timing as MisEmailTimingReport | null) ?? undefined,
  };
}

function isMissingRelationError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '42P01'
  );
}

async function misEmailSendJobsSchemaReady(): Promise<boolean> {
  if (schemaReady !== undefined) return schemaReady;
  try {
    const rows = (await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'mis_email_send_jobs'
      ) AS exists
      `
    )) as Array<{ exists: boolean }>;
    schemaReady = Boolean(rows[0]?.exists);
  } catch {
    schemaReady = false;
  }
  return schemaReady;
}

async function ensureMisEmailSendJobsSchema(): Promise<boolean> {
  if (await misEmailSendJobsSchemaReady()) return true;
  try {
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.mis_email_send_jobs (
        job_id        uuid PRIMARY KEY,
        user_id       uuid NOT NULL,
        status        text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
        message       text NOT NULL DEFAULT '',
        sent          jsonb,
        error_message text,
        duration_ms   integer,
        timing        jsonb,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await prisma.$queryRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_mis_email_send_jobs_user_updated
        ON public.mis_email_send_jobs (user_id, updated_at DESC)
    `);
    schemaReady = true;
    return true;
  } catch (err) {
    console.warn('[mis-email/send-jobs] could not ensure schema — using in-memory fallback', err);
    schemaReady = false;
    return false;
  }
}

function pruneMemoryJobs(now = Date.now()): void {
  for (const [id, job] of memoryJobs) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      memoryJobs.delete(id);
      if (activeJobByUser.get(job.userId) === id) {
        activeJobByUser.delete(job.userId);
      }
    }
  }
}

async function findActiveJobForUser(userId: string): Promise<MisEmailSendJob | null> {
  if (await ensureMisEmailSendJobsSchema()) {
    const rows = (await prisma.$queryRawUnsafe<DbMisEmailSendJobRow[]>(
      `
      SELECT job_id, user_id, status, message, sent, error_message, duration_ms, timing, created_at, updated_at
      FROM public.mis_email_send_jobs
      WHERE user_id = $1::uuid
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      userId
    )) as DbMisEmailSendJobRow[];
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  pruneMemoryJobs();
  const existingId = activeJobByUser.get(userId);
  if (!existingId) return null;
  const existing = memoryJobs.get(existingId);
  if (!existing || (existing.status !== 'queued' && existing.status !== 'running')) {
    return null;
  }
  return existing;
}

export async function createMisEmailSendJob(userId: string): Promise<MisEmailSendJob> {
  const existing = await findActiveJobForUser(userId);
  if (existing) return existing;

  const job: MisEmailSendJob = {
    id: randomUUID(),
    userId,
    status: 'queued',
    message: 'Queued — building reports in the background',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (await ensureMisEmailSendJobsSchema()) {
    await prisma.$queryRawUnsafe(
      `
      INSERT INTO public.mis_email_send_jobs (job_id, user_id, status, message)
      VALUES ($1::uuid, $2::uuid, $3, $4)
      `,
      job.id,
      job.userId,
      job.status,
      job.message
    );
    return job;
  }

  pruneMemoryJobs();
  memoryJobs.set(job.id, job);
  activeJobByUser.set(userId, job.id);
  return job;
}

export async function updateMisEmailSendJob(
  jobId: string,
  patch: Partial<
    Pick<MisEmailSendJob, 'status' | 'message' | 'sent' | 'error' | 'durationMs' | 'timing'>
  >
): Promise<MisEmailSendJob | null> {
  if (await ensureMisEmailSendJobsSchema()) {
    const rows = (await prisma.$queryRawUnsafe<DbMisEmailSendJobRow[]>(
      `
      UPDATE public.mis_email_send_jobs
      SET
        status = COALESCE($2, status),
        message = COALESCE($3, message),
        sent = COALESCE($4::jsonb, sent),
        error_message = COALESCE($5, error_message),
        duration_ms = COALESCE($6, duration_ms),
        timing = COALESCE($7::jsonb, timing),
        updated_at = now()
      WHERE job_id = $1::uuid
      RETURNING job_id, user_id, status, message, sent, error_message, duration_ms, timing, created_at, updated_at
      `,
      jobId,
      patch.status ?? null,
      patch.message ?? null,
      patch.sent ? JSON.stringify(patch.sent) : null,
      patch.error ?? null,
      patch.durationMs ?? null,
      patch.timing ? JSON.stringify(patch.timing) : null
    )) as DbMisEmailSendJobRow[];
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  const job = memoryJobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  if (job.status === 'succeeded' || job.status === 'failed') {
    activeJobByUser.delete(job.userId);
  }
  return job;
}

export async function getMisEmailSendJob(jobId: string, userId: string): Promise<MisEmailSendJob | null> {
  if (await ensureMisEmailSendJobsSchema()) {
    const rows = (await prisma.$queryRawUnsafe<DbMisEmailSendJobRow[]>(
      `
      SELECT job_id, user_id, status, message, sent, error_message, duration_ms, timing, created_at, updated_at
      FROM public.mis_email_send_jobs
      WHERE job_id = $1::uuid
        AND user_id = $2::uuid
        AND updated_at >= now() - interval '30 minutes'
      LIMIT 1
      `,
      jobId,
      userId
    )) as DbMisEmailSendJobRow[];
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  pruneMemoryJobs();
  const job = memoryJobs.get(jobId);
  if (!job || job.userId !== userId) return null;
  return job;
}

/** Lookup by job id only (UUID entropy) — for status polls when session flakes. */
export async function getMisEmailSendJobById(jobId: string): Promise<MisEmailSendJob | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return null;
  }

  if (await ensureMisEmailSendJobsSchema()) {
    const rows = (await prisma.$queryRawUnsafe<DbMisEmailSendJobRow[]>(
      `
      SELECT job_id, user_id, status, message, sent, error_message, duration_ms, timing, created_at, updated_at
      FROM public.mis_email_send_jobs
      WHERE job_id = $1::uuid
        AND updated_at >= now() - interval '30 minutes'
      LIMIT 1
      `,
      jobId
    )) as DbMisEmailSendJobRow[];
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  pruneMemoryJobs();
  return memoryJobs.get(jobId) ?? null;
}

export function resetMisEmailSendJobsSchemaCache(): void {
  schemaReady = undefined;
}

export function resetMisEmailSendJobsForTests(): void {
  schemaReady = undefined;
  memoryJobs.clear();
  activeJobByUser.clear();
}

export { isMissingRelationError as isMisEmailSendJobsMissingRelationError };
