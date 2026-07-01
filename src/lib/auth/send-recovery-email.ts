import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAppOrigin } from '@/lib/auth/site-url';
import { isSmtpConfigured } from '@/lib/mis-email/send';
import { sendPasswordResetEmail } from '@/lib/auth/send-password-reset-email';

export async function sendRecoveryEmailForAccount(params: {
  email: string;
  recipientName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const redirectTo = `${resolveAppOrigin()}/reset-password`;

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: params.email,
    options: { redirectTo },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const resetLink = data.properties?.action_link;
  if (!resetLink) {
    return { ok: false, error: 'Could not generate reset link' };
  }

  if (!isSmtpConfigured()) {
    const { error: recoverError } = await supabaseAdmin.auth.resetPasswordForEmail(params.email, {
      redirectTo,
    });
    if (recoverError) {
      return { ok: false, error: recoverError.message };
    }
    return { ok: true };
  }

  try {
    await sendPasswordResetEmail({
      to: params.email,
      resetLink,
      recipientName: params.recipientName,
    });
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to send reset email';
    return { ok: false, error: message };
  }
}
