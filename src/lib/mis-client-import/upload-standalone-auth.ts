import { resolveApiAccess } from '@/lib/auth/rbac-catalog';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
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
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(trimmed);
  if (error || !user) return null;
  return user.id;
}

export async function assertMisUploadAccess(userId: string): Promise<boolean> {
  const auth = await queryUserAuth(userId);
  if (!auth) return false;
  return resolveApiAccess(auth.permissions, { pageId: 'mis_reports', shared: true });
}
