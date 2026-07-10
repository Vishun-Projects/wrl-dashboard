import {
  relayPostJson,
  resolveVpsMailRelaySecret,
} from '@/lib/mis-email/relay-client';

export {
  DEFAULT_VPS_MAIL_RELAY_BASE,
  resolveVpsMailRelaySecret,
  resolveVpsMailRelayBaseUrl,
} from '@/lib/mis-email/relay-client';

export function isMisEmailRelayConfigured(): boolean {
  return Boolean(resolveVpsMailRelaySecret());
}

const PREPARED_DIGEST_PATH = '/internal/mail/mis-digest-prepared';

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
