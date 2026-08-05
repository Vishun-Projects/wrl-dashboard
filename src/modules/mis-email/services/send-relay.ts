import {
  relayPostJson,
  resolveVpsMailRelayBaseUrl,
  resolveVpsMailRelaySecret,
} from '@/lib/mail/relay-client';

export {
  DEFAULT_VPS_MAIL_RELAY_BASE,
  resolveVpsMailRelaySecret,
  resolveVpsMailRelayBaseUrl,
} from '@/lib/mail/relay-client';

export function isMisEmailRelayConfigured(): boolean {
  return Boolean(resolveVpsMailRelaySecret());
}

const PREPARED_DIGEST_PATH = '/internal/mail/mis-digest-prepared';

type PreparedDigestEmailAttachment = {
  filename: string;
  contentBase64: string;
  contentType: string;
};

type PreparedDigestEmailPayload = {
  to: string | string[];
  cc?: string | string[];
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

  // Relay (and older VPS builds) expect string addresses — arrays blow up on body.to.trim().
  const to = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
  const cc = payload.cc == null
    ? undefined
    : Array.isArray(payload.cc)
      ? payload.cc.join(', ')
      : payload.cc;

  try {
    const result = await relayPostJson<{ error?: string; messageId?: string }>(
      PREPARED_DIGEST_PATH,
      { ...payload, to, ...(cc !== undefined ? { cc } : {}) },
      relaySecret
    );
    return { messageId: String(result.data.messageId || '') };
  } catch (err) {
    console.error('[mis-email/relay] prepared digest failed', {
      base: resolveVpsMailRelayBaseUrl(),
      path: PREPARED_DIGEST_PATH,
      secretConfigured: true,
      secretLength: relaySecret.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
