import axios from 'axios';
import {
  formatMisVercelUploadTooLargeMessage,
  isBrowserOnVercel,
  misUploadUsesExternalHost,
  resolveMisUploadEndpoint,
  resolveMisUploadMaxBytes,
} from '@/lib/mis-client-import/upload-limits';

export function extractMisApiErrorMessage(data: unknown, status?: number): string {
  if (status === 413) {
    if (isBrowserOnVercel() && !misUploadUsesExternalHost()) {
      return (
        'File exceeds Vercel hosting limit (~4 MB). ' +
        'Set NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL on Vercel to upload large Coke/Cadbury files via VPS.'
      );
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

export function validateMisUploadFileSize(file: File): string | null {
  const maxBytes = resolveMisUploadMaxBytes();
  if (file.size <= maxBytes) return null;
  if (isBrowserOnVercel() && !misUploadUsesExternalHost()) {
    return formatMisVercelUploadTooLargeMessage(file.size);
  }
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
  return `File is ${mb} MB. Maximum upload size is ${maxMb} MB.`;
}

export async function postMisClientUpload(params: {
  sourceCode: string;
  file: File;
  accessToken?: string | null;
}): Promise<Record<string, unknown>> {
  const tooLarge = validateMisUploadFileSize(params.file);
  if (tooLarge) {
    throw new Error(tooLarge);
  }

  const formData = new FormData();
  formData.append('sourceCode', params.sourceCode);
  formData.append('file', params.file);

  const url = resolveMisUploadEndpoint();
  const external = misUploadUsesExternalHost();
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

export async function readMisUploadError(err: unknown): Promise<string> {
  if (err instanceof Error && !axios.isAxiosError(err)) {
    return err.message;
  }
  if (axios.isAxiosError(err)) {
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
