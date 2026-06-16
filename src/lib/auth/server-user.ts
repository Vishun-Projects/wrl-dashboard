import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveSupabaseUserFromCookies } from '@/lib/auth/supabase-cookie';
import {
  canVerifyJwtLocally,
  isDevAuthBypass,
  verifyLocalAccessToken,
} from '@/lib/auth/verify-jwt-core';

export type ServerAuthUser = {
  id: string;
  email?: string;
};

const EXPIRY_MARGIN_SEC = 90;

function sessionAccessTokenValid(session: {
  access_token?: string;
  expires_at?: number;
} | null): boolean {
  if (!session?.access_token) return false;
  if (session.expires_at == null) return true;
  return session.expires_at - Math.floor(Date.now() / 1000) > EXPIRY_MARGIN_SEC;
}

/** Resolve user id from Bearer access token — local JWT first, GoTrue fallback on production. */
export async function resolveUserIdFromAccessToken(token: string): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (canVerifyJwtLocally()) {
    const userId = await verifyLocalAccessToken(trimmed);
    if (userId) return userId;
  }

  if (isDevAuthBypass()) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(trimmed);
  if (error || !user) return null;
  return user.id;
}

/** Resolve user from Supabase SSR client (cookie session). */
export async function requireSupabaseUser(
  supabase: SupabaseClient
): Promise<ServerAuthUser | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token && sessionAccessTokenValid(session)) {
    if (canVerifyJwtLocally()) {
      const userId = await verifyLocalAccessToken(session.access_token);
      if (userId) {
        return { id: userId, email: session.user?.email };
      }
    }

    if (session.user?.id) {
      return { id: session.user.id, email: session.user.email };
    }
  }

  if (isDevAuthBypass()) {
    try {
      const cookieStore = await cookies();
      const fromCookies = await resolveSupabaseUserFromCookies(cookieStore.getAll());
      if (fromCookies) return fromCookies;
    } catch {
      /* cookies() unavailable outside request scope */
    }
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email };
}

/** Bearer header first, then cookie session. */
export async function resolveRequestUserId(
  request: Request,
  supabase: SupabaseClient
): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const userId = await resolveUserIdFromAccessToken(authHeader.slice(7));
    if (userId) return userId;
  }

  const user = await requireSupabaseUser(supabase);
  return user?.id ?? null;
}

export async function requireRequestUser(
  request: Request,
  supabase: SupabaseClient
): Promise<ServerAuthUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const userId = await resolveUserIdFromAccessToken(authHeader.slice(7));
    if (userId) return { id: userId };
  }

  return requireSupabaseUser(supabase);
}
