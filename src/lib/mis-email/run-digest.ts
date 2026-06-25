import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { buildDigestAttachments } from '@/lib/mis-email/build-attachments';
import {
  fetchDigestSummaryData,
  resolveDigestDateRange,
  type DigestDateRange,
} from '@/lib/mis-email/fetch-digest-data';
import {
  loadDigestRecipientById,
  loadDigestRecipients,
  type DigestRecipient,
} from '@/lib/mis-email/recipients';
import { sendDigestEmail } from '@/lib/mis-email/send';
import { resolveUserDigestScopeWithLabel } from '@/lib/mis-email/user-scope';

export type DigestSendResult = {
  recipientId: string;
  recipientEmail: string;
  sentTo: string;
  attachments: string[];
  scopeLabel: string;
  messageId: string;
};

export type DigestRunResult = {
  dateRange: DigestDateRange;
  sent: DigestSendResult[];
  skipped: Array<{ recipientId: string; reason: string }>;
  failed: Array<{ recipientId: string; email: string; error: string }>;
  durationMs: number;
};

const SEND_DELAY_MS = Number(process.env.MIS_EMAIL_SEND_DELAY_MS ?? 500);

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendForRecipient(
  recipient: DigestRecipient,
  options: { testTo?: string; dateRange?: DigestDateRange }
): Promise<DigestSendResult> {
  const dateRange = options.dateRange ?? resolveDigestDateRange();
  const scope = await resolveUserDigestScopeWithLabel(recipient);
  const data = await fetchDigestSummaryData(scope, dateRange);
  const attachments = await buildDigestAttachments(recipient, data);

  if (attachments.length === 0) {
    throw new Error('No attachments generated for recipient permissions');
  }

  const sentTo = options.testTo?.trim() || recipient.email;
  const { messageId } = await sendDigestEmail({
    to: sentTo,
    recipientName: recipient.name,
    dateRange,
    scopeLabel: scope.scopeLabel,
    attachments,
  });

  return {
    recipientId: recipient.id,
    recipientEmail: recipient.email,
    sentTo,
    attachments: attachments.map((a) => a.filename),
    scopeLabel: scope.scopeLabel,
    messageId,
  };
}

export async function runMisEmailTest(options: {
  userId?: string;
  recipientOverride?: string;
}): Promise<DigestSendResult> {
  const testTo =
    options.recipientOverride?.trim() ||
    process.env.MIS_EMAIL_TEST_TO?.trim() ||
    'vishunvishwakarma90211@gmail.com';

  let recipient: DigestRecipient | null = null;

  if (options.userId) {
    recipient = await loadDigestRecipientById(options.userId);
    if (!recipient) {
      const auth = await queryUserAuth(options.userId);
      if (!auth?.profile) {
        throw new Error(`User not found: ${options.userId}`);
      }
      const permissions = auth.permissions;
      recipient = {
        id: auth.profile.id,
        name: auth.profile.name,
        email: auth.profile.email,
        role: auth.profile.role,
        office_ids: auth.profile.office_ids ?? [],
        permissions,
        includeSummary: permissions.includes('tab_mis_summary'),
        includeKeyAccount: permissions.includes('tab_mis_accounts'),
      };
      if (!recipient.includeSummary && !recipient.includeKeyAccount) {
        throw new Error('Selected user has no MIS summary or key account tab permissions');
      }
    }
  } else {
    const recipients = await loadDigestRecipients();
    recipient = recipients[0] ?? null;
    if (!recipient) {
      throw new Error('No eligible MIS digest recipients found in app_users');
    }
  }

  return sendForRecipient(recipient, { testTo });
}

export async function runMisEmailDigest(): Promise<DigestRunResult> {
  const started = Date.now();
  const dateRange = resolveDigestDateRange();
  const recipients = await loadDigestRecipients();
  const sent: DigestSendResult[] = [];
  const skipped: Array<{ recipientId: string; reason: string }> = [];
  const failed: Array<{ recipientId: string; email: string; error: string }> = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    try {
      const result = await sendForRecipient(recipient, { dateRange });
      sent.push(result);
      console.log(
        `[mis-email] Sent to ${recipient.email} (${result.attachments.length} attachments)`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ recipientId: recipient.id, email: recipient.email, error: message });
      console.error(`[mis-email] Failed for ${recipient.email}:`, message);
    }

    if (i < recipients.length - 1) {
      await delay(SEND_DELAY_MS);
    }
  }

  if (recipients.length === 0) {
    skipped.push({ recipientId: '-', reason: 'No eligible recipients' });
  }

  return {
    dateRange,
    sent,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };
}
