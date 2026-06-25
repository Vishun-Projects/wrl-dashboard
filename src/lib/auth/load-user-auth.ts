import 'server-only';

import { cache } from 'react';
import { queryUserAuth, type UserAuthContext } from '@/lib/auth/user-auth-query';

export type { UserAuthContext };

/** Request-scoped cache: one JOIN per user id per server request. */
export const loadUserAuth = cache(async (userId: string): Promise<UserAuthContext | null> => {
  return queryUserAuth(userId);
});
