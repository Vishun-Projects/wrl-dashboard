import type { SupabaseClient } from '@supabase/supabase-js';

/** Seconds before expiry when we proactively refresh (avoids mid-request 401s). */
const REFRESH_BUFFER_SEC = 120;

let refreshInFlight: Promise<string> | null = null;

function accessTokenStillValid(session: { access_token?: string; expires_at?: number } | null): boolean {
  if (!session?.access_token) return false;
  const expiresAt = session.expires_at;
  if (expiresAt == null) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return expiresAt - nowSec > REFRESH_BUFFER_SEC;
}

/**
 * Single-flight refresh — concurrent refreshSession() calls can rotate the refresh
 * token and invalidate other tabs / in-flight requests (forced logout).
 */
export async function refreshSessionOnce(supabase: SupabaseClient): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { data, error } = await supabase.auth.refreshSession();
    const token = data.session?.access_token;
    if (error || !token) {
      throw new Error('Session expired — please sign in again and retry.');
    }
    return token;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/** Returns a valid access token; refreshes only when missing or near expiry. */
export async function ensureFreshAccessToken(supabase: SupabaseClient): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Session expired — please sign in again and retry.');
  }
  if (process.env.NODE_ENV === 'development') {
    return session.access_token;
  }
  if (accessTokenStillValid(session)) {
    return session.access_token;
  }
  try {
    return await refreshSessionOnce(supabase);
  } catch {
    return session.access_token;
  }
}

export async function getBearerAuthHeaders(
  supabase: SupabaseClient
): Promise<Record<string, string>> {
  const token = await ensureFreshAccessToken(supabase);
  return { Authorization: `Bearer ${token}` };
}
