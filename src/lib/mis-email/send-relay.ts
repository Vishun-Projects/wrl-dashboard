import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import type { MisEmailSendResult } from '@/lib/mis-email/compose-digest';
import { Agent, fetch as undiciFetch } from 'undici';

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
  const explicit = process.env.VPS_MAIL_RELAY_URL?.trim();
  if (explicit?.includes('/internal/mail/mis-digest')) {
    return explicit;
  }
  const base = resolveVpsMailRelayBaseUrl();
  return `${base}/internal/mail/mis-digest`;
}

function shouldAllowInsecureRelayTls(url: string): boolean {
  if (process.env.VPS_MAIL_RELAY_INSECURE_TLS === 'true') return true;
  if (process.env.NODE_ENV !== 'development') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'api.wrl-fsm.cloud' || host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

async function relayFetch(url: string, init: RequestInit): Promise<Response> {
  if (shouldAllowInsecureRelayTls(url)) {
    const agent = new Agent({ connect: { rejectUnauthorized: false } });
    return undiciFetch(url, {
      ...init,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }
  return fetch(url, init);
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

  let res: Response;
  try {
    res = await relayFetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mail-Relay-Secret': relaySecret,
      },
      body: JSON.stringify(params),
      cache: 'no-store',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach VPS mail relay (${relayUrl}). ${message}. ` +
        'Local dev: run `ssh -N -L 8789:127.0.0.1:8789 root@187.127.145.253` and set VPS_MAIL_RELAY_URL=http://127.0.0.1:8789/internal/mail/mis-digest'
    );
  }

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    sent?: MisEmailSendResult[];
  };

  if (!res.ok) {
    throw new Error(payload.error || `Mail relay failed (${res.status})`);
  }

  return payload.sent ?? [];
}
