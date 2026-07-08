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

async function postMisDigestRelay(
  relayUrl: string,
  relaySecret: string,
  params: { userId: string; preferences?: MisEmailPreferences; sendTo?: string[] }
): Promise<MisEmailSendResult[]> {
  const res = await relayFetch(relayUrl, {
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

function isLocalRelayUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

export type PreparedDigestEmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType: string;
};

export type PreparedDigestEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: PreparedDigestEmailAttachment[];
};

const PREPARED_DIGEST_PATH = '/internal/mail/mis-digest-prepared';

function resolvePreparedDigestRelayUrl(): string {
  const explicit = process.env.VPS_MAIL_RELAY_URL?.trim();
  if (explicit?.includes('/internal/mail/')) {
    const base = explicit.replace(/\/internal\/mail\/[^/]+$/, '');
    return `${base}${PREPARED_DIGEST_PATH}`;
  }
  const base = resolveVpsMailRelayBaseUrl();
  return `${base}${PREPARED_DIGEST_PATH}`;
}

/** Send a fully composed MIS digest via VPS Postfix (compose runs on the app server, not the relay). */
export async function sendPreparedMisEmailViaVpsRelay(
  payload: PreparedDigestEmailPayload
): Promise<{ messageId: string }> {
  const relaySecret = resolveVpsMailRelaySecret();
  if (!relaySecret) {
    throw new Error(
      'VPS mail relay is not configured — set VPS_MAIL_RELAY_SECRET (uses api.wrl-fsm.cloud Postfix by default)'
    );
  }

  const relayUrl = resolvePreparedDigestRelayUrl();
  const productionRelayUrl = `${DEFAULT_VPS_MAIL_RELAY_BASE}${PREPARED_DIGEST_PATH}`;
  const tryUrls =
    process.env.NODE_ENV === 'development' && isLocalRelayUrl(relayUrl)
      ? [relayUrl, productionRelayUrl]
      : [relayUrl];

  let lastError: Error | null = null;
  for (const url of tryUrls) {
    try {
      const res = await relayFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mail-Relay-Secret': relaySecret,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        messageId?: string;
      };

      if (!res.ok) {
        throw new Error(body.error || `Mail relay failed (${res.status})`);
      }

      return { messageId: String(body.messageId || '') };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (url !== tryUrls[tryUrls.length - 1]) {
        console.warn(`[mis-email/relay] ${url} failed, trying next relay:`, lastError.message);
      }
    }
  }

  const message = lastError?.message ?? 'Unknown relay error';
  const tried = tryUrls.join(' → ');
  if (/message file too big|552 5\.3\.4/i.test(message)) {
    throw new Error(
      `Email attachment is too large for the mail server (Postfix limit). ` +
        `Try a shorter date range, turn off the detailed register attachment, or ask ops to raise message_size_limit on the VPS. ` +
        `Underlying error: ${message}`
    );
  }
  if (/Mail relay failed \(403\)/i.test(message)) {
    throw new Error(
      `Mail relay rejected the request (403). Check VPS_MAIL_RELAY_SECRET matches the VPS .env.mis-email, ` +
        `and use VPS_MAIL_RELAY_URL=https://api.wrl-fsm.cloud (not localhost unless tunneled). ` +
        `Underlying error: ${message}`
    );
  }
  throw new Error(
    `Mail relay could not deliver the prepared email (tried: ${tried}). ` +
      'The report was built on this server but SMTP never ran. ' +
      'Use VPS_MAIL_RELAY_URL=https://api.wrl-fsm.cloud and the matching VPS_MAIL_RELAY_SECRET. ' +
      `Underlying error: ${message}`
  );
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

  const productionRelayUrl = `${DEFAULT_VPS_MAIL_RELAY_BASE}/internal/mail/mis-digest`;
  const tryUrls =
    process.env.NODE_ENV === 'development' && isLocalRelayUrl(relayUrl)
      ? [relayUrl, productionRelayUrl]
      : [relayUrl];

  let lastError: Error | null = null;
  for (const url of tryUrls) {
    try {
      return await postMisDigestRelay(url, relaySecret, params);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (url !== tryUrls[tryUrls.length - 1]) {
        console.warn(`[mis-email/relay] ${url} failed, trying next relay:`, lastError.message);
      }
    }
  }

  const message = lastError?.message ?? 'Unknown relay error';
  throw new Error(
    `Could not reach VPS mail relay (${relayUrl}). ${message}. ` +
      'Local dev: run `ssh -N -L 8789:127.0.0.1:8789 root@187.127.145.253` and set VPS_MAIL_RELAY_URL=http://127.0.0.1:8789/internal/mail/mis-digest, or rely on api.wrl-fsm.cloud with VPS_MAIL_RELAY_SECRET set.'
  );
}
