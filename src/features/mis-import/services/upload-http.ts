import { gunzipSync } from 'zlib';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { processClientMisUpload } from '@/features/mis-import/services/process-upload';
import { isGzipBuffer } from '@/features/mis-import/services/upload-gzip';
import {
  formatMisUploadTooLargeMessage,
  MIS_CLIENT_MAX_UPLOAD_BYTES,
} from '@/features/mis-import/services/upload-limits';
import { canUploadClientMis } from '@/features/mis-import/services/upload-access';
import { logAction, type AuditActor } from '@/lib/security/audit';

export type MisUploadHttpResult = {
  status: number;
  body: Record<string, unknown>;
};

export type MisUploadAuditContext = {
  request?: Request | null;
  route?: string | null;
  method?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Inflate client-gzipped upload payloads (contentEncoding=gzip or gzip magic). */
export function maybeGunzipMisUploadBuffer(
  buffer: Buffer,
  contentEncoding?: string | null
): Buffer {
  const encoding = (contentEncoding ?? '').trim().toLowerCase();
  if (encoding !== 'gzip' && !isGzipBuffer(buffer)) return buffer;
  try {
    return gunzipSync(buffer);
  } catch {
    if (encoding === 'gzip') {
      throw new Error('Uploaded file claimed gzip encoding but could not be decompressed');
    }
    return buffer;
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = sec - min * 60;
  return `${min}m ${rem.toFixed(0)}s`;
}

async function resolveUploadActor(userId: string): Promise<AuditActor> {
  const userAuth = await queryUserAuth(userId);
  return {
    userId,
    email: userAuth?.profile?.email ?? null,
    name: userAuth?.profile?.name ?? null,
  };
}

export async function logMisUploadStart(opts: {
  userId: string;
  sourceCode: string;
  fileName: string;
  audit?: MisUploadAuditContext | null;
  uploadId?: string | null;
  chunkTotal?: number | null;
  byteLength?: number | null;
}): Promise<AuditActor> {
  const actor = await resolveUploadActor(opts.userId);
  await logAction({
    request: opts.audit?.request,
    route: opts.audit?.route ?? '/api/mis-client-import/upload',
    method: opts.audit?.method ?? 'POST',
    ip: opts.audit?.ip,
    userAgent: opts.audit?.userAgent,
    action: 'import.mis_client.upload.start',
    actor,
    result: 'started',
    statusCode: 202,
    target: {
      type: 'mis_client_import_batch',
      id: opts.uploadId ?? null,
      label: opts.fileName || null,
    },
    summary: `Started MIS client import (${opts.sourceCode || 'unknown'})`,
    metadata: {
      sourceCode: opts.sourceCode || null,
      fileName: opts.fileName || null,
      uploadId: opts.uploadId ?? null,
      chunkTotal: opts.chunkTotal ?? null,
      byteLength: opts.byteLength ?? null,
    },
  });
  return actor;
}

async function logMisUploadFinish(opts: {
  userId: string;
  sourceCode: string;
  fileName: string;
  result: MisUploadHttpResult;
  audit?: MisUploadAuditContext | null;
  actor?: AuditActor | null;
  durationMs: number;
  processDurationMs?: number | null;
  byteLength?: number | null;
  uploadId?: string | null;
}): Promise<void> {
  const actor = opts.actor ?? (await resolveUploadActor(opts.userId));
  const ok = opts.result.status >= 200 && opts.result.status < 300;
  const body = opts.result.body;
  const durationLabel = formatDurationMs(opts.durationMs);
  await logAction({
    request: opts.audit?.request,
    route: opts.audit?.route ?? '/api/mis-client-import/upload',
    method: opts.audit?.method ?? 'POST',
    ip: opts.audit?.ip,
    userAgent: opts.audit?.userAgent,
    action: 'import.mis_client.upload',
    actor,
    result: ok ? 'success' : 'failure',
    statusCode: opts.result.status,
    target: {
      type: 'mis_client_import_batch',
      id: body.batchId != null ? String(body.batchId) : opts.uploadId ?? null,
      label: opts.fileName || null,
    },
    summary: ok
      ? `Finished MIS client import (${opts.sourceCode}) in ${durationLabel}`
      : `MIS client import failed (${opts.sourceCode || 'unknown'}) after ${durationLabel}`,
    metadata: {
      sourceCode: opts.sourceCode || null,
      fileName: opts.fileName || null,
      rowCount: typeof body.rowCount === 'number' ? body.rowCount : null,
      errorCount: typeof body.errorCount === 'number' ? body.errorCount : null,
      error: typeof body.error === 'string' ? body.error : null,
      durationMs: opts.durationMs,
      processDurationMs: opts.processDurationMs ?? null,
      byteLength: opts.byteLength ?? null,
      uploadId: opts.uploadId ?? null,
    },
  });
}

export async function handleMisClientUploadBuffer(params: {
  userId: string;
  sourceCode: string;
  fileName: string;
  buffer: Buffer;
  contentEncoding?: string | null;
  audit?: MisUploadAuditContext | null;
  /** When true, caller already wrote upload.start (e.g. first chunk). */
  skipStartLog?: boolean;
  /** Wall-clock start for durationMs (chunked: first chunk time). */
  startedAtMs?: number | null;
  uploadId?: string | null;
}): Promise<MisUploadHttpResult> {
  const userAuth = await queryUserAuth(params.userId);
  if (!canUploadClientMis(userAuth?.permissions ?? [])) {
    return { status: 403, body: { error: 'Forbidden' } };
  }

  const sourceCode = params.sourceCode.trim().toLowerCase();
  if (!sourceCode) {
    return { status: 400, body: { error: 'sourceCode is required' } };
  }

  let buffer: Buffer;
  try {
    buffer = maybeGunzipMisUploadBuffer(params.buffer, params.contentEncoding);
  } catch (err) {
    return {
      status: 400,
      body: { error: err instanceof Error ? err.message : 'Invalid gzip payload' },
    };
  }

  if (buffer.length > MIS_CLIENT_MAX_UPLOAD_BYTES) {
    return {
      status: 400,
      body: { error: formatMisUploadTooLargeMessage(buffer.length) },
    };
  }

  const startedAtMs = params.startedAtMs ?? Date.now();
  let actor: AuditActor | null = null;
  if (!params.skipStartLog) {
    actor = await logMisUploadStart({
      userId: params.userId,
      sourceCode,
      fileName: params.fileName,
      audit: params.audit,
      uploadId: params.uploadId,
      byteLength: buffer.length,
    });
  }

  const processStartedAtMs = Date.now();
  const result = await processClientMisUpload({
    sourceCode,
    fileName: params.fileName,
    buffer,
    uploadedBy: params.userId,
  });
  const processDurationMs = Date.now() - processStartedAtMs;

  const httpResult: MisUploadHttpResult = !result.batchId
    ? {
        status: 422,
        body: {
          error: 'Import failed — no valid rows',
          errorCount: result.errorCount,
          errors: result.errors,
          warnings: result.warnings,
        },
      }
    : {
        status: 200,
        body: {
          batchId: result.batchId,
          rowCount: result.rowCount,
          errorCount: result.errorCount,
          errors: result.errors,
          warnings: result.warnings,
          filterStart: result.filterStart,
          filterEnd: result.filterEnd,
          sourceCode,
        },
      };

  await logMisUploadFinish({
    userId: params.userId,
    sourceCode,
    fileName: params.fileName,
    result: httpResult,
    audit: params.audit,
    actor,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    processDurationMs,
    byteLength: buffer.length,
    uploadId: params.uploadId,
  });
  return httpResult;
}

export async function handleMisClientUploadFormData(params: {
  userId: string;
  formData: FormData;
  audit?: MisUploadAuditContext | null;
}): Promise<MisUploadHttpResult> {
  const sourceCode = String(params.formData.get('sourceCode') ?? '').trim().toLowerCase();
  const file = params.formData.get('file');

  if (!sourceCode) {
    return { status: 400, body: { error: 'sourceCode is required' } };
  }
  if (!(file instanceof File) && !(file && typeof file === 'object' && 'arrayBuffer' in file)) {
    return { status: 400, body: { error: 'file is required' } };
  }

  const uploadFile = file as File;
  const contentEncoding = String(params.formData.get('contentEncoding') ?? '')
    .trim()
    .toLowerCase();
  const originalFileName = String(params.formData.get('fileName') ?? '').trim();
  const fileName = originalFileName || uploadFile.name;
  const buffer = Buffer.from(await uploadFile.arrayBuffer());

  // Start after body is read — duration covers parse + import (not client upload latency).
  const startedAtMs = Date.now();
  await logMisUploadStart({
    userId: params.userId,
    sourceCode,
    fileName,
    audit: params.audit,
    byteLength: buffer.length,
  });

  return handleMisClientUploadBuffer({
    userId: params.userId,
    sourceCode,
    fileName,
    buffer,
    contentEncoding: contentEncoding || null,
    audit: params.audit,
    skipStartLog: true,
    startedAtMs,
  });
}
