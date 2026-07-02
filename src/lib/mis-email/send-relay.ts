import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import type { MisEmailSendResult } from '@/lib/mis-email/compose-digest';

const DEFAULT_VPS_MAIL_RELAY_BASE = 'https://api.wrl-fsm.cloud';

export function resolveVpsMailRelaySecret(): string | undefined {
  return process.env.VPS_MAIL_RELAY_SECRET?.trim() || undefined;
}

export function resolveVpsMailRelayBaseUrl(): string {
  const explicit = process.env.VPS_MAIL_RELAY_URL?.trim();
  if (explicit) {
    if (explicit.includes('/internal/mail/')) {
      return explicit.replace(/\/internal\/mail\/[^/]+$/, '');
    }
    return explicit.replace(/\/$/, '');
  }
  return DEFAULT_VPS_MAIL_RELAY_BASE;
}

export function isMisEmailRelayConfigured(): boolean {
  return Boolean(resolveVpsMailRelaySecret());
}

function resolveMisDigestRelayUrl(): string {
  const base = resolveVpsMailRelayBaseUrl();
  return `${base}/internal/mail/mis-digest`;
}

export async function sendMisEmailViaVpsRelay(params: {
  userId: string;
  preferences?: MisEmailPreferences;
  sendTo?: string[];
}): Promise<MisEmailSendResult[]> {
  const relayUrl = resolveMisDigestRelayUrl();
  const relaySecret = resolveVpsMailRelaySecret();
  if (!relaySecret) {
    throw new Error(
      'VPS mail relay is not configured — set VPS_MAIL_RELAY_SECRET (uses api.wrl-fsm.cloud Postfix by default)'
    );
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

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    sent?: MisEmailSendResult[];
  };

  if (!res.ok) {
    throw new Error(payload.error || `Mail relay failed (${res.status})`);
  }

  return payload.sent ?? [];
}
