import 'server-only';

export {
  canVerifyJwtLocally,
  isDevAuthBypass,
  verifyLocalAccessToken,
} from '@/lib/auth/verify-jwt-core';

/** @deprecated Use canVerifyJwtLocally() or isDevAuthBypass() */
export function isLocalAuthMode(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
}
