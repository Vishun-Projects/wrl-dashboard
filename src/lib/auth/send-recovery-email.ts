import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAppOrigin } from '@/lib/auth/site-url';
import { isSmtpConfigured } from '@/lib/mis-email/send';
import { sendPasswordResetEmail } from '@/lib/auth/send-password-reset-email';

async function sendViaVpsMailRelay(params: {
  to: string;
  resetLink: string;
  recipientName?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const relayUrl = process.env.VPS_MAIL_RELAY_URL?.trim();
  const relaySecret = process.env.VPS_MAIL_RELAY_SECRET?.trim();
  if (!relayUrl || !relaySecret) {
    return { ok: false, error: 'VPS mail relay is not configured' };
  }

  const res = await fetch(relayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mail-Relay-Secret': relaySecret,
    },
    body: JSON.stringify(params),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { ok: false, error: payload.error || `Mail relay failed (${res.status})` };
  }
  return { ok: true };
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

  if (process.env.VPS_MAIL_RELAY_URL?.trim() && process.env.VPS_MAIL_RELAY_SECRET?.trim()) {
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
