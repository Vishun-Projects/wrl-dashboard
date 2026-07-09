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

export function forgotPasswordStatusMessage(status: ForgotPasswordAccountStatus): string {
  if (!status.inAuth && !status.inAppUsers) {
    return 'No account found for this email. Contact your administrator to get portal access.';
  }
  if (!status.inAuth && status.inAppUsers) {
    return 'This email is in the user list but has no login yet. Ask an administrator to complete account setup.';
  }
  if (status.inAuth && !status.inAppUsers) {
    return 'Login exists but the portal profile is missing. Contact your administrator.';
  }
  return `Account found (${status.appUserName || status.email}). Sending password reset link…`;
}
