import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { buildDigestAttachments } from '@/lib/mis-email/build-attachments';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  resolveEffectiveBodySections,
} from '@/lib/mis-email/body-sections';
import {
  fetchDigestRegisterRows,
  fetchDigestSummaryData,
  type DigestDateRange,
} from '@/lib/mis-email/fetch-digest-data';
import {
  hasAnyEffectiveDigestInclude,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
} from '@/lib/mis-email/preferences';
import {
  loadAppUserProfileByEmail,
  loadDigestRecipientById,
  loadDigestRecipientByEmail,
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
  dateRange: DigestDateRange;
};

export type DigestRunResult = {
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

async function resolveSendContext(
  fallbackRecipient: DigestRecipient,
  sentTo: string
): Promise<{ effectiveRecipient: DigestRecipient; displayName: string }> {
  const digestUser = await loadDigestRecipientByEmail(sentTo);
  if (digestUser) {
    return { effectiveRecipient: digestUser, displayName: digestUser.name };
  }

  const profile = await loadAppUserProfileByEmail(sentTo);
  if (profile?.name.trim()) {
    return { effectiveRecipient: fallbackRecipient, displayName: profile.name };
  }

  return { effectiveRecipient: fallbackRecipient, displayName: fallbackRecipient.name };
}

async function sendForRecipient(
  recipient: DigestRecipient,
  options: { testTo?: string; dateRange?: DigestDateRange }
): Promise<DigestSendResult> {
  const sentTo = options.testTo?.trim() || recipient.email;
  const { effectiveRecipient, displayName } = await resolveSendContext(recipient, sentTo);
  const dateRange =
    options.dateRange ??
    resolveDigestDateRangeForPreferences(effectiveRecipient.mis_email_preferences);
  const effectiveIncludes = resolveEffectiveDigestIncludes(
    effectiveRecipient,
    effectiveRecipient.mis_email_preferences
  );

  if (!hasAnyEffectiveDigestInclude(effectiveIncludes)) {
    throw new Error('No report types selected for MIS email');
  }

  const scope = await resolveUserDigestScopeWithLabel(effectiveRecipient);
  const data = await fetchDigestSummaryData(scope, dateRange);
  const registerRows = effectiveIncludes.includeDetailed
    ? await fetchDigestRegisterRows(effectiveRecipient, scope, dateRange)
    : undefined;
  const attachments = await buildDigestAttachments(effectiveRecipient, data, {
    registerRows,
    effectiveIncludes,
  });

  if (attachments.length === 0) {
    throw new Error('No attachments generated for recipient permissions');
  }

  const bodySectionIds = resolveEffectiveBodySections(
    effectiveIncludes.includeSummary,
    effectiveRecipient.mis_email_preferences
  );
  const bodyHtml =
    bodySectionIds.length > 0 ? buildEmailBodySectionsHtml(bodySectionIds, data) : undefined;
  const bodyPlainText =
    bodySectionIds.length > 0 ? buildEmailBodySectionsPlainText(bodySectionIds, data) : undefined;

  const { messageId } = await sendDigestEmail({
    to: sentTo,
    recipientName: displayName,
    recipientEmail: sentTo,
    dateRange,
    scopeLabel: scope.scopeLabel,
    attachments,
    bodyHtml,
    bodyPlainText,
  });

  return {
    recipientId: effectiveRecipient.id,
    recipientEmail: effectiveRecipient.email,
    sentTo,
    attachments: attachments.map((a) => a.filename),
    scopeLabel: scope.scopeLabel,
    messageId,
    dateRange,
  };
}

/** Parse comma/semicolon-separated test recipients; bare usernames get @gmail.com. */
export function parseTestRecipientList(override?: string): string[] {
  const raw =
    override?.trim() ||
    process.env.MIS_EMAIL_TEST_TO?.trim() ||
    'vishnu.vishwakarma@westernequipments.com';

  return raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes('@') ? part : `${part}@gmail.com`));
}

export async function runMisEmailTest(options: {
  userId?: string;
  recipientOverride?: string;
}): Promise<DigestSendResult> {
  const [testTo] = parseTestRecipientList(options.recipientOverride);
  const results = await runMisEmailTestBatch({ ...options, recipients: [testTo] });
  return results[0];
}

export async function runMisEmailTestBatch(options: {
  userId?: string;
  recipients?: string[];
  recipientOverride?: string;
}): Promise<DigestSendResult[]> {
  const testRecipients = options.recipients?.length
    ? options.recipients
    : parseTestRecipientList(options.recipientOverride);

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
        visible_statuses: auth.profile.visible_statuses ?? [],
        permissions,
        includeSummary: permissions.includes('tab_mis_summary'),
        includeDetailed: permissions.includes('tab_mis_register'),
        includeKeyAccount: permissions.includes('tab_mis_accounts'),
        mis_email_enabled: true,
        mis_email_preferences: {},
      };
      if (!recipient.includeSummary && !recipient.includeDetailed && !recipient.includeKeyAccount) {
        throw new Error('Selected user has no MIS summary, register, or key account tab permissions');
      }
    }
  } else {
    const all = await loadDigestRecipients();
    recipient = all[0] ?? (await loadDigestRecipientByEmail(testRecipients[0]));
    if (!recipient) {
      throw new Error('No eligible MIS digest recipients found in app_users');
    }
  }

  const results: DigestSendResult[] = [];
  for (let i = 0; i < testRecipients.length; i++) {
    const testTo = testRecipients[i];
    results.push(await sendForRecipient(recipient, { testTo }));
    if (i < testRecipients.length - 1) {
      await delay(SEND_DELAY_MS);
    }
  }
  return results;
}

export async function runMisEmailDigest(): Promise<DigestRunResult> {
  const started = Date.now();
  const recipients = await loadDigestRecipients();
  const sent: DigestSendResult[] = [];
  const skipped: Array<{ recipientId: string; reason: string }> = [];
  const failed: Array<{ recipientId: string; email: string; error: string }> = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const sendTargets = [
      recipient.email,
      ...resolveExtraDigestEmails(recipient.mis_email_preferences, recipient.email),
    ];

    for (let t = 0; t < sendTargets.length; t++) {
      const sendTo = sendTargets[t];
      try {
        const result = await sendForRecipient(recipient, {
          testTo: sendTo === recipient.email ? undefined : sendTo,
        });
        sent.push(result);
        console.log(
          `[mis-email] Sent to ${sendTo} (${result.attachments.length} attachments, ${result.dateRange.label})`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ recipientId: recipient.id, email: sendTo, error: message });
        console.error(`[mis-email] Failed for ${sendTo}:`, message);
      }

      if (t < sendTargets.length - 1) {
        await delay(SEND_DELAY_MS);
      }
    }

    if (i < recipients.length - 1) {
      await delay(SEND_DELAY_MS);
    }
  }

  if (recipients.length === 0) {
    skipped.push({ recipientId: '-', reason: 'No eligible recipients' });
  }

  return {
    sent,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };
}
