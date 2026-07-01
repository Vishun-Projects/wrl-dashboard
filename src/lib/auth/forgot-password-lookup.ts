import 'server-only';

import { withAppClient } from '@/lib/read-model/db';
import { findAuthUserIdByEmail } from '@/lib/auth/db-create-user';

export type ForgotPasswordAccountStatus = {
  email: string;
  inAuth: boolean;
  inAppUsers: boolean;
  appUserName: string | null;
};

/** Internal portal — explicit account lookup for forgot-password UX. */
export async function lookupForgotPasswordAccount(
  email: string
): Promise<ForgotPasswordAccountStatus> {
  const normalized = email.trim().toLowerCase();

  const authId = await findAuthUserIdByEmail(normalized);

  const appRow = await withAppClient(async (client) => {
    const res = await client.query<{ name: string }>(
      `SELECT name FROM public.app_users WHERE lower(btrim(email)) = $1 LIMIT 1`,
      [normalized]
    );
    return res.rows[0] ?? null;
  });

  return {
    email: normalized,
    inAuth: Boolean(authId),
    inAppUsers: Boolean(appRow),
    appUserName: appRow?.name ?? null,
  };
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
