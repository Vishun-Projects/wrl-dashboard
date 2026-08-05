/** Safe JWT peek for diagnostics (no signature verify, never log raw token). */
export function peekAccessTokenMeta(token: string | null | undefined): Record<string, unknown> | null {
  if (!token?.trim()) return null;
  try {
    const [headerB64, payloadB64] = token.split('.');
    if (!headerB64 || !payloadB64) return { parse: 'malformed' };
    const header = JSON.parse(
      atob(headerB64.replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;
    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    return {
      alg: header.alg ?? null,
      iss: payload.iss ?? null,
      aud: payload.aud ?? null,
      exp: payload.exp ?? null,
      expInSec:
        typeof payload.exp === 'number'
          ? payload.exp - Math.floor(Date.now() / 1000)
          : null,
      subPrefix: sub ? `${sub.slice(0, 8)}…` : null,
      tokenLen: token.length,
    };
  } catch {
    return { parse: 'failed' };
  }
}

type MisUploadTraceEvent = {
  phase: string;
  fileName?: string;
  fileSize?: number;
  sourceCode?: string;
  uploadMode?: 'direct' | 'chunked';
  uploadUrlHost?: string | null;
  hasAccessToken?: boolean;
  tokenMeta?: Record<string, unknown> | null;
  httpStatus?: number | null;
  responseError?: string | null;
  axiosCode?: string | null;
  message?: string;
};

/** Browser-side diagnostic log only (no server endpoint). */
export function reportMisUploadTrace(event: MisUploadTraceEvent): void {
  try {
    console.info('[mis-upload-trace:browser]', event);
  } catch {
    /* ignore */
  }
}

