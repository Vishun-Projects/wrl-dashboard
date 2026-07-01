export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that email, you will receive password reset instructions shortly.';

export function validateForgotPasswordEmail(
  raw: string | undefined
): { ok: true; email: string } | { ok: false; error: string } {
  const email = raw?.trim().toLowerCase() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  return { ok: true, email };
}
