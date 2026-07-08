import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAppOrigin } from '@/lib/auth/site-url';
import { isSmtpConfigured } from '@/lib/mis-email/send';
import { sendPasswordResetEmail } from '@/lib/auth/send-password-reset-email';
import {
  relayPostJson,
  resolveVpsMailRelaySecret,
} from '@/lib/mis-email/relay-client';

const RESET_PATH = '/internal/mail/send';

async function sendViaVpsMailRelay(params: {
  to: string;
  resetLink: string;
  recipientName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const relaySecret = resolveVpsMailRelaySecret();
  if (!relaySecret) {
    return { ok: false, error: 'VPS mail relay is not configured' };
  }

  try {
    await relayPostJson(RESET_PATH, params, relaySecret);
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Mail relay failed';
    return { ok: false, error: message };
  }
}

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

  if (resolveVpsMailRelaySecret()) {
    const relay = await sendViaVpsMailRelay({
      to: params.email,
      resetLink,
      recipientName: params.recipientName,
    });
    if (!relay.ok) return relay;
    return { ok: true };
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
