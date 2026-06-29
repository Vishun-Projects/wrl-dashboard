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
};

export function formatMisUploadProgressLabel(progress: MisUploadProgress): string {
  const pct = progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
  const sentMb = (progress.sent / (1024 * 1024)).toFixed(1);
  const totalMb = (progress.total / (1024 * 1024)).toFixed(1);

  if (progress.phase === 'processing') {
    return `Importing rows… (${totalMb} MB uploaded)`;
  }
  if (progress.chunkTotal > 1) {
    return `Uploading part ${progress.chunkIndex}/${progress.chunkTotal} · ${sentMb}/${totalMb} MB (${pct}%)`;
  }
  return `Uploading ${sentMb} MB…`;
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
      });
    }
  }

  return lastResponse;
}

async function postMisClientUploadDirect(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
}): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append('sourceCode', params.sourceCode);
  formData.append('file', params.file);

  const external = misUploadUsesExternalHost();
  const url = external
    ? (process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim().replace(/\/$/, '') ??
      '/api/mis-client-import/upload')
    : '/api/mis-client-import/upload';

  const headers: Record<string, string> = {};
  if (external && params.accessToken) {
    headers.Authorization = `Bearer ${params.accessToken}`;
  }

  const res = await axios.post(url, formData, {
    withCredentials: !external,
    headers,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 300_000,
  });
  return res.data as Record<string, unknown>;
}

export async function postMisClientUpload(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
  onProgress?: (progress: MisUploadProgress) => void;
}): Promise<Record<string, unknown>> {
  const tooLarge = validateMisUploadFileSize(params.file);
  if (tooLarge) {
    throw new Error(tooLarge);
  }

  if (shouldUseChunkedMisUpload(params.file.size)) {
    return postMisClientUploadChunked({
      sourceCode: params.sourceCode,
      file: params.file,
      onProgress: params.onProgress,
    });
  }

  params.onProgress?.({
    sent: 0,
    total: params.file.size,
    chunkIndex: 0,
    chunkTotal: 1,
    phase: 'uploading',
  });

  const result = await postMisClientUploadDirect(params);

  params.onProgress?.({
    sent: params.file.size,
    total: params.file.size,
    chunkIndex: 1,
    chunkTotal: 1,
    phase: 'processing',
  });

  return result;
}

export async function readMisUploadError(err: unknown): Promise<string> {
  if (err instanceof Error && !axios.isAxiosError(err)) {
    return err.message;
  }
  if (axios.isAxiosError(err)) {
    if (!err.response && err.code === 'ERR_NETWORK') {
      if (misUploadUsesExternalHost()) {
        return (
          'Browser blocked the VPS upload (certificate error on api.wrl-fsm.cloud). ' +
          'Remove NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL from Vercel, redeploy, and retry — large files use chunked upload through the app.'
        );
      }
      return 'Network error during upload — check your connection and retry.';
    }
    const status = err.response?.status;
    const data = err.response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        try {
          return extractMisApiErrorMessage(JSON.parse(text) as unknown, status);
        } catch {
          return extractMisApiErrorMessage(text, status);
        }
      } catch {
        return extractMisApiErrorMessage(null, status);
      }
    }
    return extractMisApiErrorMessage(data, status);
  }
  return 'Upload failed';
}
