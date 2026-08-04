import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessPath } from '@/lib/auth/rbac-catalog';

/** Unauthed → /login; missing permission → 404 (hide route existence). */
export async function requirePageAccess(pathname: string) {
  const userInfo = await getUserInfo();
  if (!userInfo) {
    redirect('/login');
  }
  if (!canAccessPath(userInfo.permissions, pathname)) {
    notFound();
  }
  return userInfo;
}
