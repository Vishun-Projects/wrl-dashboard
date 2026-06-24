import type { NextRequest } from 'next/server';
import { isChunkLike, stringFromBase64URL } from '@supabase/ssr';
import { verifyLocalAccessToken } from '@/lib/auth/verify-jwt-core';

/** Matches supabase-js / persistSessionCookies storage key derivation. */
export function getSupabaseAuthStorageKey(supabaseUrl: string): string {
  const baseUrl = new URL(supabaseUrl.replace(/\/$/, ''));
  return `sb-${baseUrl.hostname.split('.')[0]}-auth-token`;
}

function decodeStoredSession(encoded: string): { access_token?: string; user?: { email?: string } } | null {
  try {
    const json =
      encoded.startsWith('base64-')
        ? stringFromBase64URL(encoded.slice('base64-'.length))
        : decodeURIComponent(encoded);
    return JSON.parse(json) as { access_token?: string; user?: { email?: string } };
  } catch {
    return null;
  }
}

export function readSupabaseAccessTokenFromCookies(
  cookies: { name: string; value: string }[]
): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;

  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  const chunks = cookies
    .filter((c) => isChunkLike(c.name, storageKey))
    .sort((a, b) => a.name.localeCompare(b.name));

  const encoded =
    chunks.length > 0
      ? chunks.map((c) => c.value).join('')
      : cookies.find((c) => c.name === storageKey)?.value;

  if (!encoded) return null;

  const session = decodeStoredSession(encoded);
  const token = session?.access_token?.trim();
  return token || null;
}

export function readSupabaseAccessTokenFromRequest(request: NextRequest): string | null {
  return readSupabaseAccessTokenFromCookies(request.cookies.getAll());
}

export async function resolveUserIdFromSupabaseCookies(
  request: NextRequest
): Promise<string | null> {
  const token = readSupabaseAccessTokenFromRequest(request);
  if (!token) return null;
  return verifyLocalAccessToken(token);
}

export async function resolveSupabaseUserFromCookies(
  cookies: { name: string; value: string }[]
): Promise<{ id: string; email?: string } | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;

  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  const chunks = cookies
    .filter((c) => isChunkLike(c.name, storageKey))
    .sort((a, b) => a.name.localeCompare(b.name));
  const encoded =
    chunks.length > 0
      ? chunks.map((c) => c.value).join('')
      : cookies.find((c) => c.name === storageKey)?.value;
  if (!encoded) return null;

  const session = decodeStoredSession(encoded);
  const token = session?.access_token?.trim();
  if (!token) return null;

  const userId = await verifyLocalAccessToken(token);
  if (userId) return { id: userId, email: session?.user?.email };

  const embedded = session?.user as { id?: string; email?: string } | undefined;
  if (embedded?.id) {
    return { id: String(embedded.id), email: embedded.email };
  }
  return null;
}
