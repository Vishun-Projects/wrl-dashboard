import { createClient } from '@supabase/supabase-js';
import { resolveApiAccess } from '@/lib/auth/rbac-catalog';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { canUploadClientMis } from '@/features/mis-import/lib/upload-access';
import {
  canVerifyJwtLocally,
  verifyLocalAccessToken,
} from '@/lib/auth/verify-jwt-core';

/** Fallback when local JWT verify fails — do not import `@/lib/supabase/admin` (server-only). */
async function getUserIdViaGoTrue(token: string): Promise<string | null> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  if (!supabaseUrl || !serviceKey) {
    console.warn(
      '[mis-upload-auth] getUser skipped — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'
    );
    return null;
  }

  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);
    if (error || !user) {
      console.warn(
        '[mis-upload-auth] getUser failed:',
        error?.message ?? 'no user',
        canVerifyJwtLocally() ? '(local JWT verify also failed)' : '(no SUPABASE_JWT_SECRET)'
      );
      return null;
    }
    return user.id;
  } catch (err) {
    console.warn(
      '[mis-upload-auth] getUser threw:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function resolveMisUploadUserId(token: string): Promise<string | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  if (canVerifyJwtLocally()) {
    const userId = await verifyLocalAccessToken(trimmed);
    if (userId) return userId;
    console.warn(
      '[mis-upload-auth] local JWT verify failed — falling back to auth.getUser (check SUPABASE_JWT_SECRET matches GoTrue)'
    );
  }

  return getUserIdViaGoTrue(trimmed);
}

export async function assertMisUploadAccess(userId: string): Promise<boolean> {
  const auth = await queryUserAuth(userId);
  if (!auth) return false;
  if (!resolveApiAccess(auth.permissions, { pageId: 'mis_reports', shared: true })) {
    return false;
  }
  return canUploadClientMis(auth.permissions);
}

/** Download only needs MIS reports page access (matches Next download route). */
export async function assertMisDownloadAccess(userId: string): Promise<boolean> {
  const auth = await queryUserAuth(userId);
  if (!auth) return false;
  return resolveApiAccess(auth.permissions, { pageId: 'mis_reports', shared: true });
}
