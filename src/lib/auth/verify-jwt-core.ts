import { jwtVerify } from 'jose';

/** Verify Supabase access JWT locally (no GoTrue HTTPS). Edge + Node safe. */
export async function verifyLocalAccessToken(token: string): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) return null;

  const key = new TextEncoder().encode(secret);
  const clockTolerance =
    process.env.NODE_ENV === 'development' ? { clockTolerance: '7 days' as const } : {};

  try {
    const { payload } = await jwtVerify(token, key, {
      issuer: 'supabase',
      audience: 'authenticated',
      ...clockTolerance,
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch (strictErr) {
    // Self-hosted tokens sometimes omit/ mismatch iss/aud — retry without those checks.
    try {
      const { payload } = await jwtVerify(token, key, clockTolerance);
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch (looseErr) {
      const detail =
        looseErr instanceof Error
          ? looseErr.message
          : strictErr instanceof Error
            ? strictErr.message
            : 'jwt verify failed';
      if (process.env.MIS_UPLOAD_DEBUG_JWT === '1') {
        console.warn('[verifyLocalAccessToken]', detail);
      }
      return null;
    }
  }
}

export function canVerifyJwtLocally(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
}

/** Dev-only: skip GoTrue HTTPS when api.wrl-fsm.cloud is unreachable from localhost. */
export function isDevAuthBypass(): boolean {
  return process.env.NODE_ENV === 'development' && canVerifyJwtLocally();
}
