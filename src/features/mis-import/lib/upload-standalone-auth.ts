import { resolveApiAccess } from '@/lib/auth/rbac-catalog';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { canUploadClientMis } from '@/features/mis-import/lib/upload-access';
import {
  canVerifyJwtLocally,
  verifyLocalAccessToken,
} from '@/lib/auth/verify-jwt-core';
import { supabaseAdmin } from '@/lib/supabase/admin';

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

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(trimmed);
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

export async function assertMisUploadAccess(userId: string): Promise<boolean> {
  const auth = await queryUserAuth(userId);
  if (!auth) return false;
  if (!resolveApiAccess(auth.permissions, { pageId: 'mis_reports', shared: true })) {
    return false;
  }
  return canUploadClientMis(auth.permissions);
}
