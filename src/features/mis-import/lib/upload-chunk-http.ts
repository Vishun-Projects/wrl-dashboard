import {
  assembleAndProcessUpload,
  getUploadChunkStatus,
  purgeStaleUploadChunks,
  storeUploadChunk,
} from '@/features/mis-import/lib/upload-chunks';
import {
  logMisUploadStart,
  type MisUploadAuditContext,
  type MisUploadHttpResult,
} from '@/features/mis-import/lib/upload-http';
import { MIS_UPLOAD_CHUNK_BYTES_MAX } from '@/features/mis-import/lib/upload-chunk-constants';

/** Shared chunk POST handler for Next route + VPS upload server. */
export async function handleMisClientUploadChunkFormData(params: {
  userId: string;
  formData: FormData;
  audit?: MisUploadAuditContext | null;
}): Promise<MisUploadHttpResult> {
  void purgeStaleUploadChunks().catch(() => {});

  const uploadId = String(params.formData.get('uploadId') ?? '').trim();
  const finalize = String(params.formData.get('finalize') ?? '').trim() === '1';
  const contentEncoding = String(params.formData.get('contentEncoding') ?? '')
    .trim()
    .toLowerCase();

  if (finalize) {
    if (!uploadId) {
      return { status: 400, body: { error: 'uploadId is required' } };
    }
    const result = await assembleAndProcessUpload(
      uploadId,
      params.userId,
      contentEncoding || null,
      params.audit
    );
    return { status: result.status, body: { ...result.body, complete: true } };
  }

  const chunkIndex = Number(params.formData.get('chunkIndex'));
  const chunkTotal = Number(params.formData.get('chunkTotal'));
  const sourceCode = String(params.formData.get('sourceCode') ?? '').trim().toLowerCase();
  const fileName = String(params.formData.get('fileName') ?? '').trim();
  const chunk = params.formData.get('chunk');

  if (!uploadId || !Number.isInteger(chunkIndex) || !Number.isInteger(chunkTotal)) {
    return { status: 400, body: { error: 'uploadId, chunkIndex, chunkTotal are required' } };
  }
  if (chunkTotal < 1 || chunkIndex < 0 || chunkIndex >= chunkTotal) {
    return { status: 400, body: { error: 'Invalid chunk index' } };
  }
  if (!sourceCode || !fileName) {
    return { status: 400, body: { error: 'sourceCode and fileName are required' } };
  }
  if (!(chunk instanceof File) && !(chunk && typeof chunk === 'object' && 'arrayBuffer' in chunk)) {
    return { status: 400, body: { error: 'chunk is required' } };
  }

  const chunkFile = chunk as File;
  if (chunkFile.size > MIS_UPLOAD_CHUNK_BYTES_MAX) {
    return { status: 413, body: { error: 'Chunk exceeds size limit' } };
  }

  const buffer = Buffer.from(await chunkFile.arrayBuffer());

  // First chunk = upload began (covers transfer + later import in duration).
  if (chunkIndex === 0) {
    await logMisUploadStart({
      userId: params.userId,
      sourceCode,
      fileName,
      audit: params.audit,
      uploadId,
      chunkTotal,
      byteLength: null,
    });
  }

  await storeUploadChunk({
    uploadId,
    chunkIndex,
    chunkTotal,
    sourceCode,
    fileName,
    uploadedBy: params.userId,
    data: buffer,
  });

  return {
    status: 200,
    body: {
      uploadId,
      chunkIndex,
      chunkTotal,
      complete: false,
    },
  };
}

export async function handleMisClientUploadChunkStatus(params: {
  userId: string;
  uploadId: string;
}): Promise<MisUploadHttpResult> {
  return getUploadChunkStatus({
    uploadId: params.uploadId,
    uploadedBy: params.userId,
  });
}
