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
  try {
    const cookieStore = await cookies();
    const fromCookies = await resolveSupabaseUserFromCookies(cookieStore.getAll());
    if (fromCookies) return fromCookies;
  } catch {
    /* cookies() unavailable outside request scope */
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (!error && user) {
    return { id: user.id, email: user.email };
  }

  if (isDevAuthBypass()) {
    return null;
  }

  return null;
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
    const bearer = authHeader.slice(7).trim();
    if (bearer && bearer !== 'undefined') {
      const userId = await resolveUserIdFromAccessToken(bearer);
      if (userId) return { id: userId };
    }
  }

  try {
    const cookieStore = await cookies();
    const fromCookies = await resolveSupabaseUserFromCookies(cookieStore.getAll());
    if (fromCookies) return fromCookies;
  } catch {
    /* cookies() unavailable outside request scope */
  }

  return requireSupabaseUser(supabase);
}
