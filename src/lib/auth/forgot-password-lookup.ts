import 'server-only';

import { withAppClient } from '@/lib/read-model/db';
import { findAuthUserIdByEmail } from '@/lib/auth/db-create-user';
import { forgotPasswordStatusMessage, type ForgotPasswordAccountStatus } from '@/lib/auth/forgot-password-core';

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

export { forgotPasswordStatusMessage };
