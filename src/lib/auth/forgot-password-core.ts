export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that email, you will receive password reset instructions shortly.';

export type ForgotPasswordAccountStatus = {
  email: string;
  inAuth: boolean;
  inAppUsers: boolean;
  appUserName: string | null;
};

export function validateForgotPasswordEmail(
  raw: string | undefined
): { ok: true; email: string } | { ok: false; error: string } {
  const email = raw?.trim().toLowerCase() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  return { ok: true, email };
}

/** Audit / admin-facing reason only — never show to the requester. */
export function forgotPasswordAuditReason(status: ForgotPasswordAccountStatus): string {
  if (!status.inAuth && !status.inAppUsers) return 'account_not_found';
  if (!status.inAuth && status.inAppUsers) return 'app_user_without_auth';
  if (status.inAuth && !status.inAppUsers) return 'auth_without_app_user';
  return 'account_ready';
}
