import axios from 'axios';
import {
  formatMisVercelUploadTooLargeMessage,
  isBrowserOnVercel,
  misUploadUsesExternalHost,
  MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES,
  resolveMisUploadMaxBytes,
} from '@/features/mis-import/lib/upload-limits';
import {
  MIS_UPLOAD_CHUNK_CONCURRENCY,
  MIS_UPLOAD_CHUNK_RETRIES,
  resolveMisUploadChunkBytes,
  resolveMisUploadChunkUrl,
  shouldUseChunkedMisUpload,
} from '@/features/mis-import/lib/upload-chunk-constants';
import {
  gzipBlobForMisUpload,
  isMisUploadCompressibleFileName,
} from '@/features/mis-import/lib/upload-gzip';
import {
  clearMisUploadResumeState,
  loadMisUploadResumeState,
  missingMisUploadChunkIndexes,
  misUploadFingerprint,
  saveMisUploadResumeState,
  type MisUploadResumeState,
} from '@/features/mis-import/lib/upload-resume';
import {
  peekAccessTokenMeta,
  reportMisUploadTrace,
} from '@/features/mis-import/lib/upload-trace';

export function extractMisApiErrorMessage(data: unknown, status?: number): string {
  if (status === 413) {
    if (isBrowserOnVercel()) {
      return formatMisVercelUploadTooLargeMessage(MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES);
    }
    return 'Upload was rejected because the file is too large for this server.';
  }

  if (typeof data === 'string' && data.trim()) {
    return data.trim().slice(0, 500);
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) {
      const detail =
        typeof record.detail === 'string' && record.detail.trim()
          ? `: ${record.detail.trim()}`
          : '';
      return `${record.error.trim()}${detail}`.slice(0, 500);
    }
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.trim()) {
        return nested.message;
      }
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
  }

  if (status === 403) return 'You are not allowed to upload client files.';
  if (status === 401) return 'Session expired — sign in again.';
  return 'Upload failed';
}

export type MisUploadProgress = {
  sent: number;
  total: number;
  chunkIndex: number;
  chunkTotal: number;
  phase: 'uploading' | 'processing' | 'compressing';
  fileIndex?: number;
  fileTotal?: number;
  fileName?: string;
  /** Uncompressed file size when wire payload is gzipped. */
  originalTotal?: number;
  resuming?: boolean;
};

export function formatMisUploadProgressLabel(progress: MisUploadProgress): string {
  const pct = progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  const sentMb = (progress.sent / (1024 * 1024)).toFixed(1);
  const totalMb = (progress.total / (1024 * 1024)).toFixed(1);
  const filePrefix =
    progress.fileTotal && progress.fileTotal > 1 && progress.fileIndex
      ? `File ${progress.fileIndex}/${progress.fileTotal}${progress.fileName ? ` (${progress.fileName})` : ''} · `
      : '';
  const resumePrefix = progress.resuming ? 'Resuming · ' : '';
  const originalNote =
    progress.originalTotal && progress.originalTotal > progress.total
      ? ` · was ${(progress.originalTotal / (1024 * 1024)).toFixed(1)} MB`
      : '';

  if (progress.phase === 'compressing') {
    return `${filePrefix}Compressing…`;
  }
  if (progress.phase === 'processing') {
    return `${filePrefix}Importing rows… (${totalMb} MB uploaded${originalNote})`;
  }
  if (progress.chunkTotal > 1) {
    return `${filePrefix}${resumePrefix}Uploading part ${progress.chunkIndex}/${progress.chunkTotal} · ${sentMb}/${totalMb} MB (${pct}%)${originalNote}`;
  }
  return `${filePrefix}${resumePrefix}Uploading ${sentMb} MB…${originalNote}`;
}

export function estimateMisUploadEtaSec(
  progress: MisUploadProgress,
  startedAtMs: number
): number | null {
  if (progress.phase !== 'uploading' || progress.sent <= 0) return null;
  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  if (elapsedSec < 2) return null;
  const rate = progress.sent / elapsedSec;
  const remaining = progress.total - progress.sent;
  if (rate <= 0) return null;
  return Math.ceil(remaining / rate);
}

export function validateMisUploadFileSize(file: File): string | null {
  const maxBytes = resolveMisUploadMaxBytes();
  if (file.size <= maxBytes) return null;
  if (shouldUseChunkedMisUpload(file.size)) return null;
  if (isBrowserOnVercel()) {
    return formatMisVercelUploadTooLargeMessage(file.size);
  }
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
  return `File is ${mb} MB. Maximum upload size is ${maxMb} MB.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableChunkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (!err.response) {
    return (
      err.code === 'ERR_NETWORK' ||
      err.code === 'ECONNABORTED' ||
      /certificate|SSL|TLS|Failed to fetch|Network Error/i.test(err.message)
    );
  }
  const status = err.response.status;
  return status >= 500 || status === 429;
}

async function prepareMisUploadPayload(file: File): Promise<{
  blob: Blob;
  contentEncoding: 'gzip' | null;
  originalSize: number;
}> {
  if (!isMisUploadCompressibleFileName(file.name)) {
    return { blob: file, contentEncoding: null, originalSize: file.size };
  }
  const { blob, encoding } = await gzipBlobForMisUpload(file);
  return { blob, contentEncoding: encoding, originalSize: file.size };
}

async function fetchChunkStatus(params: {
  uploadId: string;
  accessToken?: string | null;
}): Promise<number[]> {
  const url = `${resolveMisUploadChunkUrl()}?uploadId=${encodeURIComponent(params.uploadId)}`;
  const external = misUploadUsesExternalHost();
  const headers: Record<string, string> = {};
  if (external && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }
  try {
    const res = await axios.get(url, {
      withCredentials: !external,
      headers,
      timeout: 60_000,
    });
    const received = res.data?.received;
    return Array.isArray(received)
      ? received.filter((n: unknown) => Number.isInteger(n)).map((n: number) => n)
      : [];
  } catch {
    return [];
  }
}

async function postChunkWithRetry(params: {
  url: string;
  formData: FormData;
  accessToken?: string | null;
  external: boolean;
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (params.external && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MIS_UPLOAD_CHUNK_RETRIES; attempt++) {
    try {
      const res = await axios.post(params.url, params.formData, {
        withCredentials: !params.external,
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300_000,
      });
      return res.data as Record<string, unknown>;
    } catch (err) {
      lastErr = err;
      if (!isRetryableChunkError(err) || attempt === MIS_UPLOAD_CHUNK_RETRIES - 1) {
        throw err;
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      await worker(items[idx]!);
    }
  });
  await Promise.all(runners);
}

async function postMisClientUploadChunked(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
  fileIndex?: number;
  fileTotal?: number;
}): Promise<Record<string, unknown>> {
  params.onProgress?.({
    sent: 0,
    total: params.file.size,
    chunkIndex: 0,
    chunkTotal: 1,
    phase: 'compressing',
    fileIndex: params.fileIndex,
    fileTotal: params.fileTotal,
    fileName: params.file.name,
    originalTotal: params.file.size,
  });

  const prepared = await prepareMisUploadPayload(params.file);
  const transferBlob = prepared.blob;
  const transferSize = transferBlob.size;
  const contentEncoding = prepared.contentEncoding;
  const chunkBytes = resolveMisUploadChunkBytes();
  const chunkTotal = Math.max(1, Math.ceil(transferSize / chunkBytes));
  const fingerprint = misUploadFingerprint({
    fileName: params.file.name,
    fileSize: params.file.size,
    lastModified: params.file.lastModified,
    sourceCode: params.sourceCode,
  });

  let resume = loadMisUploadResumeState(fingerprint);
  if (resume && resume.chunkTotal !== chunkTotal) {
    clearMisUploadResumeState();
    resume = null;
  }

  const uploadId = resume?.uploadId ?? crypto.randomUUID();
  const external = misUploadUsesExternalHost();
  const url = resolveMisUploadChunkUrl();

  if (external && !params.accessToken?.trim()) {
    throw new Error('Sign in again to upload large files to the VPS.');
  }

  const serverReceived = resume
    ? await fetchChunkStatus({ uploadId, accessToken: params.accessToken })
    : [];
  const missing = missingMisUploadChunkIndexes(
    chunkTotal,
    resume?.completed ?? [],
    serverReceived
  );
  const completed = new Set<number>([
    ...(resume?.completed ?? []),
    ...serverReceived,
  ]);
  const resuming = completed.size > 0 && missing.length > 0;

  const progressBase = {
    fileIndex: params.fileIndex,
    fileTotal: params.fileTotal,
    fileName: params.file.name,
    originalTotal: prepared.originalSize,
    resuming,
  };

  const emitProgress = (sent: number, chunkIndex: number) => {
    params.onProgress?.({
      sent,
      total: transferSize,
      chunkIndex,
      chunkTotal,
      phase: 'uploading',
      ...progressBase,
    });
  };

  emitProgress(
    Math.min(transferSize, completed.size * chunkBytes),
    Math.max(1, completed.size)
  );

  const persist = () => {
    const state: MisUploadResumeState = {
      uploadId,
      fingerprint,
      chunkTotal,
      completed: [...completed].sort((a, b) => a - b),
      contentEncoding,
      originalFileName: params.file.name,
      transferSize,
    };
    saveMisUploadResumeState(state);
  };
  persist();

  await runWithConcurrency(missing, MIS_UPLOAD_CHUNK_CONCURRENCY, async (chunkIndex) => {
    const start = chunkIndex * chunkBytes;
    const end = Math.min(transferSize, start + chunkBytes);
    const blob = transferBlob.slice(start, end);

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('chunkTotal', String(chunkTotal));
    formData.append('sourceCode', params.sourceCode);
    formData.append('fileName', params.file.name);
    if (contentEncoding) formData.append('contentEncoding', contentEncoding);
    formData.append('chunk', blob, params.file.name);
    if (external && params.accessToken) {
      formData.append('accessToken', params.accessToken);
    }

    await postChunkWithRetry({
      url,
      formData,
      accessToken: params.accessToken,
      external,
    });

    completed.add(chunkIndex);
    persist();
    emitProgress(Math.min(transferSize, completed.size * chunkBytes), completed.size);
  });

  params.onProgress?.({
    sent: transferSize,
    total: transferSize,
    chunkIndex: chunkTotal,
    chunkTotal,
    phase: 'processing',
    ...progressBase,
  });

  const finalizeData = new FormData();
  finalizeData.append('uploadId', uploadId);
  finalizeData.append('finalize', '1');
  if (contentEncoding) finalizeData.append('contentEncoding', contentEncoding);
  if (external && params.accessToken) {
    finalizeData.append('accessToken', params.accessToken);
  }

  const result = await postChunkWithRetry({
    url,
    formData: finalizeData,
    accessToken: params.accessToken,
    external,
  });

  clearMisUploadResumeState();
  return result;
}

async function postMisClientUploadDirect(params: {
  sourceCode: string;
  file: File;
  payload: Blob;
  contentEncoding: 'gzip' | null;
  originalSize: number;
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
  fileIndex?: number;
  fileTotal?: number;
}): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('sourceCode', params.sourceCode);
  formData.append('file', params.payload, params.file.name);
  formData.append('fileName', params.file.name);
  if (params.contentEncoding) {
    formData.append('contentEncoding', params.contentEncoding);
  }

  const external = misUploadUsesExternalHost();
  const url = external
    ? (process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim().replace(/\/$/, '') ??
      '/api/mis-client-import/upload')
    : '/api/mis-client-import/upload';

  let uploadUrlHost: string | null = null;
  try {
    uploadUrlHost = external ? new URL(url).host : (typeof window !== 'undefined' ? window.location.host : 'same-origin');
  } catch {
    uploadUrlHost = url;
  }

  if (external && !params.accessToken?.trim()) {
    reportMisUploadTrace({
      phase: 'direct_missing_token',
      fileName: params.file.name,
      fileSize: params.file.size,
      sourceCode: params.sourceCode,
      uploadMode: 'direct',
      uploadUrlHost,
      hasAccessToken: false,
    });
    throw new Error('Sign in again to upload large files to the VPS.');
  }

  const headers: Record<string, string> = {};
  if (external && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
    formData.append('accessToken', params.accessToken);
  }

  reportMisUploadTrace({
    phase: 'direct_start',
    fileName: params.file.name,
    fileSize: params.payload.size,
    sourceCode: params.sourceCode,
    uploadMode: 'direct',
    uploadUrlHost,
    hasAccessToken: Boolean(params.accessToken?.trim()),
    tokenMeta: peekAccessTokenMeta(params.accessToken),
  });

  const progressBase = {
    fileIndex: params.fileIndex,
    fileTotal: params.fileTotal,
    fileName: params.file.name,
    originalTotal: params.originalSize,
  };

  try {
    const res = await axios.post(url, formData, {
      withCredentials: !external,
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300_000,
      onUploadProgress: (event) => {
        const total = event.total && event.total > 0 ? event.total : params.payload.size;
        const sent = Math.min(event.loaded, total);
        const uploadDone = total > 0 && sent >= total;
        params.onProgress?.({
          sent: uploadDone ? total : sent,
          total,
          chunkIndex: 1,
          chunkTotal: 1,
          phase: uploadDone ? 'processing' : 'uploading',
          ...progressBase,
        });
      },
    });
    reportMisUploadTrace({
      phase: 'direct_ok',
      fileName: params.file.name,
      fileSize: params.payload.size,
      sourceCode: params.sourceCode,
      uploadMode: 'direct',
      uploadUrlHost,
      hasAccessToken: Boolean(params.accessToken?.trim()),
      httpStatus: res.status,
    });
    return res.data as Record<string, unknown>;
  } catch (err) {
    const status = axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
    let responseError: string | null = null;
    if (axios.isAxiosError(err) && err.response?.data) {
      const data = err.response.data;
      if (typeof data === 'string') responseError = data.slice(0, 300);
      else if (data && typeof data === 'object') {
        const rec = data as Record<string, unknown>;
        const base = String(rec.error ?? rec.message ?? JSON.stringify(data));
        const detail =
          typeof rec.detail === 'string' && rec.detail.trim() ? `: ${rec.detail.trim()}` : '';
        responseError = `${base}${detail}`.slice(0, 400);
      }
    }
    reportMisUploadTrace({
      phase: 'direct_fail',
      fileName: params.file.name,
      fileSize: params.payload.size,
      sourceCode: params.sourceCode,
      uploadMode: 'direct',
      uploadUrlHost,
      hasAccessToken: Boolean(params.accessToken?.trim()),
      tokenMeta: peekAccessTokenMeta(params.accessToken),
      httpStatus: status,
      responseError,
      axiosCode: axios.isAxiosError(err) ? (err.code ?? null) : null,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function isDirectUploadNetworkFailure(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.response) return false;
  return (
    err.code === 'ERR_NETWORK' ||
    err.code === 'ECONNABORTED' ||
    /certificate|SSL|TLS|Failed to fetch|Network Error/i.test(err.message)
  );
}

export async function postMisClientUpload(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
  fileIndex?: number;
  fileTotal?: number;
}): Promise<Record<string, unknown>> {
  const tooLarge = validateMisUploadFileSize(params.file);
  if (tooLarge) {
    throw new Error(tooLarge);
  }

  const progressBase = {
    fileIndex: params.fileIndex,
    fileTotal: params.fileTotal,
    fileName: params.file.name,
  };

  // Decide chunking on (possibly compressed) wire size after prep for small files;
  // for large originals always chunk so resume works.
  if (shouldUseChunkedMisUpload(params.file.size)) {
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
      accessToken: params.accessToken,
      onProgress: params.onProgress,
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
    });
  }

  params.onProgress?.({
    sent: 0,
    total: params.file.size,
    chunkIndex: 0,
    chunkTotal: 1,
    phase: 'compressing',
    ...progressBase,
    originalTotal: params.file.size,
  });

  const prepared = await prepareMisUploadPayload(params.file);

  if (shouldUseChunkedMisUpload(prepared.blob.size)) {
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
      accessToken: params.accessToken,
      onProgress: params.onProgress,
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
    });
  }

  params.onProgress?.({
    sent: 0,
    total: prepared.blob.size,
    chunkIndex: 0,
    chunkTotal: 1,
    phase: 'uploading',
    ...progressBase,
    originalTotal: prepared.originalSize,
  });

  try {
    const result = await postMisClientUploadDirect({
      sourceCode: params.sourceCode,
      file: params.file,
      payload: prepared.blob,
      contentEncoding: prepared.contentEncoding,
      originalSize: prepared.originalSize,
      accessToken: params.accessToken,
      onProgress: params.onProgress,
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
    });

    params.onProgress?.({
      sent: prepared.blob.size,
      total: prepared.blob.size,
      chunkIndex: 1,
      chunkTotal: 1,
      phase: 'processing',
      ...progressBase,
      originalTotal: prepared.originalSize,
    });

    return result;
  } catch (err) {
    const canFallbackToChunks =
      misUploadUsesExternalHost() &&
      isBrowserOnVercel() &&
      isDirectUploadNetworkFailure(err) &&
      params.file.size > 0;

    if (!canFallbackToChunks) {
      throw err;
    }

    console.warn(
      '[mis-client-import] Direct VPS upload failed; falling back to chunked upload',
      err
    );
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
      accessToken: params.accessToken,
      onProgress: params.onProgress,
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
    });
  }
}

export type MisUploadQueueResult = {
  file: File;
  data?: Record<string, unknown>;
  error?: string;
};

export async function runMisClientUploadQueue(params: {
  sourceCode: string;
  files: File[];
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
  uploadFn?: (args: {
    sourceCode: string;
    file: File;
    accessToken?: string | null;
    onProgress?: (progress: MisUploadProgress) => void;
    fileIndex?: number;
    fileTotal?: number;
  }) => Promise<Record<string, unknown>>;
}): Promise<MisUploadQueueResult[]> {
  const upload = params.uploadFn ?? postMisClientUpload;
  const fileTotal = params.files.length;
  const results: MisUploadQueueResult[] = [];

  for (let i = 0; i < params.files.length; i++) {
    const file = params.files[i]!;
    try {
      const data = await upload({
        sourceCode: params.sourceCode,
        file,
        accessToken: params.accessToken,
        onProgress: params.onProgress,
        fileIndex: i + 1,
        fileTotal,
      });
      results.push({ file, data });
    } catch (err: unknown) {
      results.push({ file, error: await readMisUploadError(err) });
    }
  }

  return results;
}

export async function readMisUploadError(err: unknown): Promise<string> {
  if (err instanceof Error && !axios.isAxiosError(err)) {
    return err.message;
  }
  if (axios.isAxiosError(err)) {
    if (!err.response && err.code === 'ERR_NETWORK') {
      if (misUploadUsesExternalHost()) {
        return (
          'Could not reach the VPS upload endpoint (network or certificate). ' +
          'Check NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL, CORS, and that fast-close-mis-upload is running — ' +
          'or retry; the app may fall back to chunked upload automatically.'
        );
      }
      return 'Network error during upload — check your connection and retry.';
    }
    const status = err.response?.status;
    const data = err.response?.data;
    let message: string;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        try {
          message = extractMisApiErrorMessage(JSON.parse(text) as unknown, status);
        } catch {
          message = extractMisApiErrorMessage(text, status);
        }
      } catch {
        message = extractMisApiErrorMessage(null, status);
      }
    } else {
      message = extractMisApiErrorMessage(data, status);
    }
    if (status && misUploadUsesExternalHost()) {
      return `VPS upload HTTP ${status}: ${message}`;
    }
    return message;
  }
  return 'Upload failed';
}
