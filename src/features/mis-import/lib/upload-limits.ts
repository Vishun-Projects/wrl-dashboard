/** Max MIS client file upload (CSV / Excel) on VPS / local dev. */
export const MIS_CLIENT_MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export const MIS_CLIENT_MAX_UPLOAD_LABEL = '300 MB';

/** Vercel serverless request body cap (multipart needs headroom below 4.5 MB). */
export const MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MIS_CLIENT_VERCEL_MAX_UPLOAD_LABEL = '4 MB';

export function formatMisUploadTooLargeMessage(fileBytes: number): string {
  const mb = (fileBytes / (1024 * 1024)).toFixed(1);
  return `File is ${mb} MB. Maximum upload size is ${MIS_CLIENT_MAX_UPLOAD_LABEL}.`;
}

export function formatMisVercelUploadTooLargeMessage(fileBytes: number): string {
  const mb = (fileBytes / (1024 * 1024)).toFixed(1);
  return (
    `File is ${mb} MB. Vercel same-origin uploads are limited to ~${MIS_CLIENT_VERCEL_MAX_UPLOAD_LABEL}. ` +
    'Set NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL to https://api.wrl-fsm.cloud/api/mis-client-import/upload ' +
    'and redeploy for a single direct VPS upload, or use chunked upload / local import.'
  );
}

export function isBrowserOnVercel(): boolean {
  if (typeof window === 'undefined') return false;
  return /vercel\.app$/i.test(window.location.hostname);
}

export function resolveMisUploadMaxBytes(uploadBaseUrl?: string | null): number {
  if (uploadBaseUrl?.trim()) return MIS_CLIENT_MAX_UPLOAD_BYTES;
  if (process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim()) {
    return MIS_CLIENT_MAX_UPLOAD_BYTES;
  }
  if (process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_URL) {
    return MIS_CLIENT_VERCEL_MAX_UPLOAD_BYTES;
  }
  return MIS_CLIENT_MAX_UPLOAD_BYTES;
}

export function resolveMisUploadEndpoint(): string {
  const external = process.env.NEXT_PUBLIC_MIS_CLIENT_UPLOAD_URL?.trim();
  if (external) return external.replace(/\/$/, '');
  return '/api/mis-client-import/upload';
}

export function misUploadUsesExternalHost(): boolean {
  const endpoint = resolveMisUploadEndpoint();
  return endpoint.startsWith('http://') || endpoint.startsWith('https://');
}
