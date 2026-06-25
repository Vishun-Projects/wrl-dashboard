import type { SupabaseClient } from '@supabase/supabase-js';
import { browserTokenRefreshDisabled } from '@/lib/api/cookie-auth';

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
 * Single-flight refresh — only for Supabase Cloud. Self-hosted uses cookie auth;
 * browser refresh to api.wrl-fsm.cloud fails with ERR_CERT_AUTHORITY_INVALID.
 */
export async function refreshSessionOnce(supabase: SupabaseClient): Promise<string> {
  if (browserTokenRefreshDisabled()) {
    throw new Error('Session refresh disabled — use withCredentials for API requests');
  }

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

/** Returns a valid access token; refreshes only on Supabase Cloud. */
export async function ensureFreshAccessToken(supabase: SupabaseClient): Promise<string> {
  if (browserTokenRefreshDisabled()) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      return session.access_token;
    }
    throw new Error('Session refresh disabled — use withCredentials for API requests');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Session expired — please sign in again and retry.');
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
