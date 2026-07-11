import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { buildMisEmailPayload } from '@/lib/mis-email/compose-digest';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  normalizeMisEmailSendTime,
  resolveMisEmailSendTimeIst,
  resolveDigestDateRangeForPreferences,
  resolveExtraDigestEmails,
  shouldSendMisEmailNow,
} from '@/lib/mis-email/preferences';
import {
  loadAppUserProfileByEmail,
  loadDigestRecipientById,
  loadDigestRecipientByEmail,
  loadDigestRecipients,
  type DigestRecipient,
} from '@/lib/mis-email/recipients';
import { sendDigestEmail } from '@/lib/mis-email/send';
import { resolveUserDigestScope } from '@/lib/mis-email/user-scope';
import {
  listMatchingMisEmailRoutingRulesForResolvedClients,
  listMisEmailRoutingRules,
  logMisEmailRoutingSendAttempt,
  resolveRoutingClientNamesForScope,
  resolveRoutingScopeForOfficeIds,
  shouldTriggerRoutingRuleNow,
} from '@/lib/mis-email/routing-rules';

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
  options: {
    testTo?: string;
    to?: string[];
    cc?: string[];
    dateRange?: DigestDateRange;
  }
): Promise<DigestSendResult> {
  const toList = (
    options.to?.length ? options.to : [options.testTo?.trim() || recipient.email]
  )
    .map((email) => email.trim())
    .filter(Boolean);
  if (toList.length === 0) {
    throw new Error('Add at least one To recipient');
  }
  const toLower = new Set(toList.map((email) => email.toLowerCase()));
  const ccList = (options.cc ?? [])
    .map((email) => email.trim())
    .filter((email) => email && !toLower.has(email.toLowerCase()));
  const primaryTo = toList[0];
  const { effectiveRecipient, displayName } = await resolveSendContext(recipient, primaryTo);
  const dateRange =
    options.dateRange ??
    resolveDigestDateRangeForPreferences(effectiveRecipient.mis_email_preferences);

  const { preview, emailAttachments, scopeLabel, bodyHtml, bodyPlainText } =
    await buildMisEmailPayload(effectiveRecipient, {
      sentTo: primaryTo,
      displayName,
      dateRange,
    });

  const { messageId } = await sendDigestEmail({
    to: toList.length === 1 ? toList[0] : toList,
    cc: ccList.length ? ccList : undefined,
    recipientName: displayName,
    recipientEmail: primaryTo,
    dateRange,
    scopeLabel,
    attachments: emailAttachments,
    bodyHtml,
    bodyPlainText,
  });

  return {
    recipientId: effectiveRecipient.id,
    recipientEmail: effectiveRecipient.email,
    sentTo: toList.join(', '),
    attachments: preview.attachments,
    scopeLabel,
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
  cc?: string[];
  ccOverride?: string;
}): Promise<DigestSendResult[]> {
  const testRecipients = options.recipients?.length
    ? options.recipients
    : parseTestRecipientList(options.recipientOverride);

  const ccRaw = options.ccOverride?.trim() || process.env.MIS_EMAIL_TEST_CC?.trim() || '';
  const ccRecipients = (
    options.cc?.length ? options.cc : ccRaw ? parseTestRecipientList(ccRaw) : []
  ).filter((email) => email.trim());

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

  // One SMTP message with To + optional Cc (matches automated routing delivery).
  const result = await sendForRecipient(recipient, {
    to: testRecipients,
    cc: ccRecipients,
  });
  return [result];
}

export async function runMisEmailDigest(): Promise<DigestRunResult> {
  const started = Date.now();
  const recipients = await loadDigestRecipients();
  const sent: DigestSendResult[] = [];
  const skipped: Array<{ recipientId: string; reason: string }> = [];
  const failed: Array<{ recipientId: string; email: string; error: string }> = [];
  const scheduleWindowMinutes = Math.max(
    1,
    Number(process.env.MIS_EMAIL_SCHEDULE_WINDOW_MINUTES ?? 15)
  );
  const routingRules = await listMisEmailRoutingRules();

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const digestScope = resolveUserDigestScope(recipient);
    const [scope, clientNames] = await Promise.all([
      resolveRoutingScopeForOfficeIds(recipient.office_ids ?? []),
      resolveRoutingClientNamesForScope({
        officeIds: recipient.office_ids ?? [],
        isHod: digestScope.isHod,
        dateRangeMode:
          recipient.mis_email_preferences.dateRange ?? DEFAULT_MIS_EMAIL_PREFERENCES.dateRange,
      }),
    ]);
    const matchingRules = listMatchingMisEmailRoutingRulesForResolvedClients({
      rules: routingRules,
      zones: scope.zones,
      branches: scope.branches,
      mailClients: clientNames.mail,
      crmClients: clientNames.crm,
    });

    if (matchingRules.length === 0) {
      if (
        !shouldSendMisEmailNow(recipient.mis_email_preferences, {
          windowMinutes: scheduleWindowMinutes,
        })
      ) {
        skipped.push({
          recipientId: recipient.id,
          reason: `Outside send window (IST ${resolveMisEmailSendTimeIst(recipient.mis_email_preferences)})`,
        });
        continue;
      }
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
      }
      if (i < recipients.length - 1) {
        await delay(SEND_DELAY_MS);
      }
      continue;
    }

    for (const rule of matchingRules) {
      if (!rule.autoSendEnabled) {
        skipped.push({
          recipientId: recipient.id,
          reason: `Auto-send disabled by HOD routing rule (${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'})`,
        });
        await logMisEmailRoutingSendAttempt({
          ruleId: rule.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          sentTo: recipient.email,
          status: 'skipped',
          error: 'Auto-send disabled',
        });
        continue;
      }
      const personalSendTime = normalizeMisEmailSendTime(
        recipient.mis_email_preferences.sendTimeIst
      );
      const effectiveSendTime = personalSendTime ?? rule.scheduleAnchorTimeIst;
      if (
        !shouldTriggerRoutingRuleNow(rule, {
          windowMinutes: scheduleWindowMinutes,
          // Saved personal digest time wins over rule anchor (fixes 09:30 ignored by 07:00 catch-all).
          sendTimeIst: personalSendTime,
        })
      ) {
        skipped.push({
          recipientId: recipient.id,
          reason: `Rule not due now (send ${effectiveSendTime} IST · rule anchor ${rule.scheduleAnchorTimeIst} · every ${rule.scheduleIntervalMinutes}m)`,
        });
        continue;
      }

      const toEmails = [...new Set(rule.toEmails.map((email) => email.trim()).filter(Boolean))];
      if (toEmails.length === 0) {
        skipped.push({
          recipientId: recipient.id,
          reason: `Routing rule has no To recipients (${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'})`,
        });
        continue;
      }
      const ccEmails = [...new Set(rule.ccEmails.map((email) => email.trim()).filter(Boolean))];
      const sentToLabel = toEmails.join(', ');
      try {
        const result = await sendForRecipient(recipient, {
          to: toEmails,
          cc: ccEmails,
        });
        sent.push(result);
        await logMisEmailRoutingSendAttempt({
          ruleId: rule.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          sentTo: sentToLabel,
          status: 'sent',
        });
        console.log(
          `[mis-email] Sent to ${sentToLabel}${ccEmails.length ? ` cc ${ccEmails.join(', ')}` : ''} (${result.attachments.length} attachments, ${result.dateRange.label})`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ recipientId: recipient.id, email: sentToLabel, error: message });
        await logMisEmailRoutingSendAttempt({
          ruleId: rule.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          sentTo: sentToLabel,
          status: 'failed',
          error: message,
        });
        console.error(`[mis-email] Failed for ${sentToLabel}:`, message);
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
