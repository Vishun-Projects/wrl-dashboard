import axios from 'axios';
import {
  formatMisVercelUploadTooLargeMessage,
  isBrowserOnVercel,
  misUploadUsesExternalHost,
  MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES,
  resolveMisUploadMaxBytes,
} from '@/lib/mis-client-import/upload-limits';
import {
  MIS_UPLOAD_CHUNK_BYTES,
  shouldUseChunkedMisUpload,
} from '@/lib/mis-client-import/upload-chunk-constants';
import {
  peekAccessTokenMeta,
  reportMisUploadTrace,
} from '@/lib/mis-client-import/upload-trace';

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
      return record.error;
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
  phase: 'uploading' | 'processing';
  fileIndex?: number;
  fileTotal?: number;
  fileName?: string;
};

export function formatMisUploadProgressLabel(progress: MisUploadProgress): string {
  const pct = progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  const sentMb = (progress.sent / (1024 * 1024)).toFixed(1);
  const totalMb = (progress.total / (1024 * 1024)).toFixed(1);
  const filePrefix =
    progress.fileTotal && progress.fileTotal > 1 && progress.fileIndex
      ? `File ${progress.fileIndex}/${progress.fileTotal}${progress.fileName ? ` (${progress.fileName})` : ''} · `
      : '';

  if (progress.phase === 'processing') {
    return `${filePrefix}Importing rows… (${totalMb} MB uploaded)`;
  }
  if (progress.chunkTotal > 1) {
    return `${filePrefix}Uploading part ${progress.chunkIndex}/${progress.chunkTotal} · ${sentMb}/${totalMb} MB (${pct}%)`;
  }
  return `${filePrefix}Uploading ${sentMb} MB…`;
}

export function estimateMisUploadEtaSec(
  progress: MisUploadProgress,
  startedAtMs: number
): number | null {
  if (progress.phase === 'processing' || progress.sent <= 0) return null;
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

async function postMisClientUploadChunked(params: {
  sourceCode: string;
  file: File;
  onProgress?: (progress: MisUploadProgress) => void;
  fileIndex?: number;
  fileTotal?: number;
}): Promise<Record<string, unknown>> {
  const uploadId = crypto.randomUUID();
  const chunkTotal = Math.max(1, Math.ceil(params.file.size / MIS_UPLOAD_CHUNK_BYTES));
  let lastResponse: Record<string, unknown> = {};

  for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex++) {
    const start = chunkIndex * MIS_UPLOAD_CHUNK_BYTES;
    const end = Math.min(params.file.size, start + MIS_UPLOAD_CHUNK_BYTES);
    const blob = params.file.slice(start, end);
    const isLast = chunkIndex === chunkTotal - 1;

    params.onProgress?.({
      sent: start,
      total: params.file.size,
      chunkIndex: chunkIndex + 1,
      chunkTotal,
      phase: 'uploading',
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
      fileName: params.file.name,
    });

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('chunkTotal', String(chunkTotal));
    formData.append('sourceCode', params.sourceCode);
    formData.append('fileName', params.file.name);
    formData.append('chunk', blob, params.file.name);

    if (isLast) {
      params.onProgress?.({
        sent: params.file.size,
        total: params.file.size,
        chunkIndex: chunkTotal,
        chunkTotal,
        phase: 'processing',
        fileIndex: params.fileIndex,
        fileTotal: params.fileTotal,
        fileName: params.file.name,
      });
    }

    const res = await axios.post('/api/mis-client-import/upload-chunk', formData, {
      withCredentials: true,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300_000,
    });
    lastResponse = res.data as Record<string, unknown>;

    if (!isLast) {
      params.onProgress?.({
        sent: end,
        total: params.file.size,
        chunkIndex: chunkIndex + 1,
        chunkTotal,
        phase: 'uploading',
        fileIndex: params.fileIndex,
        fileTotal: params.fileTotal,
        fileName: params.file.name,
      });
    }
  }

  return lastResponse;
}

async function postMisClientUploadDirect(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
  fileIndex?: number;
  fileTotal?: number;
}): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('sourceCode', params.sourceCode);
  formData.append('file', params.file);

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
    // Backup if a proxy strips Authorization on multipart requests.
    formData.append('accessToken', params.accessToken);
  }

  reportMisUploadTrace({
    phase: 'direct_start',
    fileName: params.file.name,
    fileSize: params.file.size,
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
  };

  try {
    const res = await axios.post(url, formData, {
      withCredentials: !external,
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 300_000,
      onUploadProgress: (event) => {
        const total = event.total && event.total > 0 ? event.total : params.file.size;
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
      fileSize: params.file.size,
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
        responseError = String(rec.error ?? rec.message ?? JSON.stringify(data)).slice(0, 300);
      }
    }
    reportMisUploadTrace({
      phase: 'direct_fail',
      fileName: params.file.name,
      fileSize: params.file.size,
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

  if (shouldUseChunkedMisUpload(params.file.size)) {
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
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
    phase: 'uploading',
    ...progressBase,
  });

  try {
    const result = await postMisClientUploadDirect({
      sourceCode: params.sourceCode,
      file: params.file,
      accessToken: params.accessToken,
      onProgress: params.onProgress,
      fileIndex: params.fileIndex,
      fileTotal: params.fileTotal,
    });

    params.onProgress?.({
      sent: params.file.size,
      total: params.file.size,
      chunkIndex: 1,
      chunkTotal: 1,
      phase: 'processing',
      ...progressBase,
    });

    return result;
  } catch (err) {
    // Vercel + VPS URL: one-shot direct is preferred; fall back to same-origin chunks if TLS/network blocks the VPS.
    const canFallbackToChunks =
      misUploadUsesExternalHost() &&
      isBrowserOnVercel() &&
      isDirectUploadNetworkFailure(err) &&
      params.file.size > 0;

    if (!canFallbackToChunks) {
      throw err;
    }

    console.warn(
      '[mis-client-import] Direct VPS upload failed; falling back to chunked same-origin upload',
      err
    );
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
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
