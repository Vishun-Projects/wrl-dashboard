import { jwtVerify } from 'jose';

/** Verify Supabase access JWT locally (no GoTrue HTTPS). Edge + Node safe. */
export async function verifyLocalAccessToken(token: string): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET?.trim();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'supabase',
      audience: 'authenticated',
      // Local dev tokens are not refreshed (autoRefreshToken: false) — allow stale sessions.
      ...(process.env.NODE_ENV === 'development' ? { clockTolerance: '7 days' as const } : {}),
    });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function canVerifyJwtLocally(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
}

/** Dev-only: skip GoTrue HTTPS when api.wrl-fsm.cloud is unreachable from localhost. */
export function isDevAuthBypass(): boolean {
  return process.env.NODE_ENV === 'development' && canVerifyJwtLocally();
}
