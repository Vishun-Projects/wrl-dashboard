import 'server-only';

import {
  createChunks,
  DEFAULT_COOKIE_OPTIONS,
  isChunkLike,
  stringToBase64URL,
} from '@supabase/ssr';
import { getSupabaseAuthStorageKey } from '@/lib/auth/supabase-cookie';

type SessionUser = {
  id: string;
  email?: string;
};

export type PersistableSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: SessionUser;
};

type CookieSetOptions = {
  path?: string;
  maxAge?: number;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
};

type CookieWriter = {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options: CookieSetOptions }[]): void;
};

/** Matches supabase-js default auth storage key derivation. */
export { getSupabaseAuthStorageKey } from '@/lib/auth/supabase-cookie';

function buildStoredSession(payload: PersistableSession) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = payload.expires_at ?? nowSec + (payload.expires_in ?? 3600);
  const expiresIn = payload.expires_in ?? Math.max(expiresAt - nowSec, 0);
  const user = payload.user;

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: expiresAt,
    expires_in: expiresIn,
    token_type: payload.token_type ?? 'bearer',
    user: user
      ? {
          id: user.id,
          email: user.email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
        }
      : undefined,
  };
}

/**
 * Write Supabase SSR auth cookies without calling GoTrue (setSession → getUser).
 * Required when HTTPS to api.wrl-fsm.cloud is blocked but Postgres auth works.
 */
export function persistSessionCookies(
  cookieWriter: CookieWriter,
  sessionPayload: PersistableSession
): void {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }

  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  const sessionJson = JSON.stringify(buildStoredSession(sessionPayload));
  const encoded = `base64-${stringToBase64URL(sessionJson)}`;

  const cookieNames = cookieWriter.getAll().map((cookie) => cookie.name);
  const removeCookies = cookieNames.filter((name) => isChunkLike(name, storageKey));
  const chunks = createChunks(storageKey, encoded);

  const removeCookieOptions = {
    path: DEFAULT_COOKIE_OPTIONS.path,
    maxAge: 0,
    sameSite: 'lax' as const,
    httpOnly: DEFAULT_COOKIE_OPTIONS.httpOnly,
  };
  const setCookieOptions = {
    path: DEFAULT_COOKIE_OPTIONS.path,
    maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,
    sameSite: 'lax' as const,
    httpOnly: DEFAULT_COOKIE_OPTIONS.httpOnly,
  };

  cookieWriter.setAll([
    ...removeCookies.map((name) => ({
      name,
      value: '',
      options: removeCookieOptions,
    })),
    ...chunks.map(({ name, value }) => ({
      name,
      value,
      options: setCookieOptions,
    })),
  ]);
}

/** Remove Supabase SSR auth cookies (sign-out without calling GoTrue). */
export function clearSessionCookies(cookieWriter: CookieWriter): void {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  }

  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  const cookieNames = cookieWriter.getAll().map((cookie) => cookie.name);
  const removeCookies = cookieNames.filter((name) => isChunkLike(name, storageKey));

  const removeCookieOptions = {
    path: DEFAULT_COOKIE_OPTIONS.path,
    maxAge: 0,
    sameSite: 'lax' as const,
    httpOnly: DEFAULT_COOKIE_OPTIONS.httpOnly,
  };

  cookieWriter.setAll(
    removeCookies.map((name) => ({
      name,
      value: '',
      options: removeCookieOptions,
    }))
  );
}
