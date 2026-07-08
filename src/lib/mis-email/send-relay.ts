import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import type { MisEmailSendResult } from '@/lib/mis-email/compose-digest';
import {
  relayPostJson,
  resolveRelayTryUrls,
  resolveVpsMailRelaySecret,
  resolveVpsMailRelayBaseUrl,
} from '@/lib/mis-email/relay-client';

export {
  DEFAULT_VPS_MAIL_RELAY_BASE,
  resolveVpsMailRelaySecret,
  resolveVpsMailRelayBaseUrl,
} from '@/lib/mis-email/relay-client';

export function isMisEmailRelayConfigured(): boolean {
  return Boolean(resolveVpsMailRelaySecret());
}

const MIS_DIGEST_PATH = '/internal/mail/mis-digest';
const PREPARED_DIGEST_PATH = '/internal/mail/mis-digest-prepared';

function resolveMisDigestRelayUrl(): string {
  const urls = resolveRelayTryUrls(MIS_DIGEST_PATH);
  return urls[0] ?? `${resolveVpsMailRelayBaseUrl()}${MIS_DIGEST_PATH}`;
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

  const result = await relayPostJson<{ error?: string; messageId?: string }>(
    PREPARED_DIGEST_PATH,
    payload,
    relaySecret
  );

  return { messageId: String(result.data.messageId || '') };
}

export async function sendMisEmailViaVpsRelay(params: {
  userId: string;
  preferences?: MisEmailPreferences;
  sendTo?: string[];
}): Promise<MisEmailSendResult[]> {
  const relaySecret = resolveVpsMailRelaySecret();
  if (!relaySecret) {
    throw new Error(
      'VPS mail relay is not configured — set VPS_MAIL_RELAY_SECRET (uses api.wrl-fsm.cloud Postfix by default)'
    );
  }

  const result = await relayPostJson<{ error?: string; sent?: MisEmailSendResult[] }>(
    MIS_DIGEST_PATH,
    params,
    relaySecret
  );

  return result.data.sent ?? [];
}

/** Exposed for diagnostics — first URL the client would try. */
export function resolvePreparedDigestRelayUrl(): string {
  const urls = resolveRelayTryUrls(PREPARED_DIGEST_PATH);
  return urls[0] ?? `${resolveVpsMailRelayBaseUrl()}${PREPARED_DIGEST_PATH}`;
}

/** @deprecated use resolvePreparedDigestRelayUrl */
export function resolveMisDigestRelayUrlForDiagnostics(): string {
  return resolveMisDigestRelayUrl();
}
