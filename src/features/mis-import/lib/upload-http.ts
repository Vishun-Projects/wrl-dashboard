import { gunzipSync } from 'zlib';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { processClientMisUpload } from '@/features/mis-import/lib/process-upload';
import { isGzipBuffer } from '@/features/mis-import/lib/upload-gzip';
import {
  formatMisUploadTooLargeMessage,
  MIS_CLIENT_MAX_UPLOAD_BYTES,
} from '@/features/mis-import/lib/upload-limits';
import { canUploadClientMis } from '@/features/mis-import/lib/upload-access';

export type MisUploadHttpResult = {
  status: number;
  body: Record<string, unknown>;
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

export async function handleMisClientUploadBuffer(params: {
  userId: string;
  sourceCode: string;
  fileName: string;
  buffer: Buffer;
  contentEncoding?: string | null;
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

  const result = await processClientMisUpload({
    sourceCode,
    fileName: params.fileName,
    buffer,
    uploadedBy: params.userId,
  });

  if (!result.batchId) {
    return {
      status: 422,
      body: {
        error: 'Import failed — no valid rows',
        errorCount: result.errorCount,
        errors: result.errors,
        warnings: result.warnings,
      },
    };
  }

  return {
    status: 200,
    body: {
      batchId: result.batchId,
      rowCount: result.rowCount,
      errorCount: result.errorCount,
      errors: result.errors,
      warnings: result.warnings,
      filterStart: result.filterStart,
      filterEnd: result.filterEnd,
    },
  };
}

export async function handleMisClientUploadFormData(params: {
  userId: string;
  formData: FormData;
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
  const buffer = Buffer.from(await uploadFile.arrayBuffer());
  return handleMisClientUploadBuffer({
    userId: params.userId,
    sourceCode,
    fileName: originalFileName || uploadFile.name,
    buffer,
    contentEncoding: contentEncoding || null,
  });
}
