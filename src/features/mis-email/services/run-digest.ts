import { queryUserAuth } from '@/lib/auth/user-auth-query';
import {
  hasMisEmailSendAccess,
  resolveMisEmailReportIncludes,
} from '@/lib/auth/rbac-catalog';
import { buildMisEmailPayload } from '@/features/mis-email/services/compose-digest';
import type { DigestDateRange } from '@/features/mis-email/services/fetch-digest-data';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  resolveMisEmailSendTimeIst,
  resolveDigestDateRangeForPreferences,
  resolvePersonalDigestTargets,
  shouldSendMisEmailNow,
} from '@/features/mis-email/services/preferences';
import {
  loadAppUserProfileByEmail,
  loadDigestRecipientById,
  loadDigestRecipientByEmail,
  loadDigestRecipients,
  type DigestRecipient,
} from '@/features/mis-email/services/recipients';
import { sendDigestEmail } from '@/features/mis-email/services/send';
import { resolveUserDigestScope } from '@/features/mis-email/services/user-scope';
import {
  hasSuccessfulRoutingSendInSlot,
  listMatchingMisEmailRoutingRulesForResolvedClients,
  listMisEmailRoutingRules,
  logMisEmailRoutingSendAttempt,
  resolveRoutingClientNamesForScope,
  resolveRoutingScopeForOfficeIds,
  resolveRoutingScheduleSlotStart,
  shouldTriggerRoutingRuleNow,
} from '@/features/mis-email/services/routing-rules';
import { logAction } from '@/lib/security/audit';

const DIGEST_SYSTEM_ACTOR = {
  userId: null,
  email: 'system:mis-email-digest',
  name: 'MIS email digest',
};

async function auditDigestSend(opts: {
  ok: boolean;
  sentTo: string;
  recipientId: string;
  attachmentCount?: number;
  dateRangeLabel?: string;
  ruleId?: string | null;
  error?: string;
}): Promise<void> {
  await logAction({
    action: opts.ok
      ? 'notification.mis_email.digest.sent'
      : 'notification.mis_email.digest.failed',
    actor: DIGEST_SYSTEM_ACTOR,
    result: opts.ok ? 'success' : 'failure',
    statusCode: opts.ok ? 200 : 500,
    target: {
      type: 'mis_email_digest',
      id: opts.recipientId,
      label: opts.sentTo,
    },
    summary: opts.ok
      ? `Sent MIS digest to ${opts.sentTo}`
      : `MIS digest failed for ${opts.sentTo}`,
    metadata: {
      recipientCount: 1,
      attachmentCount: opts.attachmentCount ?? null,
      dateRangeLabel: opts.dateRangeLabel ?? null,
      ruleId: opts.ruleId ?? null,
      error: opts.error ?? null,
    },
  });
}

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
  const { isVpsCronPaused } = await import('@/lib/vps-cron/settings');
  if (await isVpsCronPaused('mis_email_test')) {
    console.log('[mis-email] Test digest skipped — paused in portal (VPS Cron)');
    return [];
  }

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
      const includes = resolveMisEmailReportIncludes(permissions);
      recipient = {
        id: auth.profile.id,
        name: auth.profile.name,
        email: auth.profile.email,
        role: auth.profile.role,
        office_ids: auth.profile.office_ids ?? [],
        visible_statuses: auth.profile.visible_statuses ?? [],
        permissions,
        includeSummary: includes.includeSummary,
        includeDetailed: includes.includeDetailed,
        includeKeyAccount: includes.includeKeyAccount,
        mis_email_enabled: true,
        mis_email_preferences: {},
      };
      if (!includes.includeSummary && !includes.includeDetailed && !includes.includeKeyAccount) {
        throw new Error('Selected user has no MIS summary, register, or key account access');
      }
      if (!hasMisEmailSendAccess(permissions)) {
        throw new Error('Selected user role is missing the “MIS email reports” capability');
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
  const { isVpsCronPaused } = await import('@/lib/vps-cron/settings');
  if (await isVpsCronPaused('mis_email_digest')) {
    console.log('[mis-email] Digest skipped — paused in portal (VPS Cron)');
    return { sent: [], skipped: [], failed: [], durationMs: Date.now() - started };
  }

  const recipients = await loadDigestRecipients();
  const sent: DigestSendResult[] = [];
  const skipped: Array<{ recipientId: string; reason: string }> = [];
  const failed: Array<{ recipientId: string; email: string; error: string }> = [];
  const scheduleWindowMinutes = Math.max(
    1,
    Number(process.env.MIS_EMAIL_SCHEDULE_WINDOW_MINUTES ?? 15)
  );
  const routingRules = await listMisEmailRoutingRules();

  async function sendPersonalForRecipient(recipient: DigestRecipient): Promise<void> {
    if (
      !shouldSendMisEmailNow(recipient.mis_email_preferences, {
        windowMinutes: scheduleWindowMinutes,
      })
    ) {
      skipped.push({
        recipientId: recipient.id,
        reason: `Personal digest outside send window (IST ${resolveMisEmailSendTimeIst(recipient.mis_email_preferences)})`,
      });
      return;
    }
    // Only Profile To/Cc — never routing rule recipients, never org default seed lists.
    const { to, cc } = resolvePersonalDigestTargets(
      recipient.mis_email_preferences,
      recipient.email
    );
    if (to.length === 0) {
      skipped.push({
        recipientId: recipient.id,
        reason: 'Personal digest has no To recipients in Profile',
      });
      return;
    }
    const sentToLabel = to.join(', ');
    try {
      const result = await sendForRecipient(recipient, { to, cc });
      sent.push(result);
      await auditDigestSend({
        ok: true,
        sentTo: sentToLabel,
        recipientId: recipient.id,
        attachmentCount: result.attachments.length,
        dateRangeLabel: result.dateRange.label,
      });
      console.log(
        `[mis-email] Personal digest to ${sentToLabel}${cc.length ? ` cc ${cc.join(', ')}` : ''} (${result.attachments.length} attachments, ${result.dateRange.label})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ recipientId: recipient.id, email: sentToLabel, error: message });
      await auditDigestSend({
        ok: false,
        sentTo: sentToLabel,
        recipientId: recipient.id,
        error: message,
      });
      console.error(`[mis-email] Personal digest failed for ${sentToLabel}:`, message);
    }
  }

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    // Personal schedule is always for this account only — never blocked by HOD routing auto-send.
    await sendPersonalForRecipient(recipient);

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

    // Prefer the best-scoring match only — avoid duplicate SMTP when catch-all + zone rules match.
    const rule = matchingRules[0];
    if (!rule) {
      if (i < recipients.length - 1) await delay(SEND_DELAY_MS);
      continue;
    }

    if (!rule.autoSendEnabled) {
      skipped.push({
        recipientId: recipient.id,
        reason: `Routing auto-send off (${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'}) — personal digest still independent`,
      });
      await logMisEmailRoutingSendAttempt({
        ruleId: rule.id,
        recipientId: recipient.id,
        recipientEmail: recipient.email,
        sentTo: recipient.email,
        status: 'skipped',
        error: 'Auto-send disabled',
      });
    } else {
      // Routing uses the RULE schedule only — never the user's personal Profile send time.
      // Changing Profile time must only affect personal digests (self), not HOD To/Cc blasts.
      if (
        !shouldTriggerRoutingRuleNow(rule, {
          windowMinutes: scheduleWindowMinutes,
        })
      ) {
        skipped.push({
          recipientId: recipient.id,
          reason: `Routing rule not due now (rule anchor ${rule.scheduleAnchorTimeIst} · every ${rule.scheduleIntervalMinutes}m)`,
        });
      } else {
        const slotStart = resolveRoutingScheduleSlotStart(rule);
        if (
          await hasSuccessfulRoutingSendInSlot({
            ruleId: rule.id,
            recipientId: recipient.id,
            since: slotStart,
          })
        ) {
          skipped.push({
            recipientId: recipient.id,
            reason: `Routing already sent for this schedule slot (since ${slotStart.toISOString()} · rule ${rule.scheduleAnchorTimeIst} IST)`,
          });
        } else {
          const toEmails = [...new Set(rule.toEmails.map((email) => email.trim()).filter(Boolean))];
          if (toEmails.length === 0) {
            skipped.push({
              recipientId: recipient.id,
              reason: `Routing rule has no To recipients (${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'})`,
            });
          } else {
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
              await auditDigestSend({
                ok: true,
                sentTo: sentToLabel,
                recipientId: recipient.id,
                attachmentCount: result.attachments.length,
                dateRangeLabel: result.dateRange.label,
                ruleId: rule.id,
              });
              console.log(
                `[mis-email] Routing digest to ${sentToLabel}${ccEmails.length ? ` cc ${ccEmails.join(', ')}` : ''} (${result.attachments.length} attachments, ${result.dateRange.label})`
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
              await auditDigestSend({
                ok: false,
                sentTo: sentToLabel,
                recipientId: recipient.id,
                ruleId: rule.id,
                error: message,
              });
              console.error(`[mis-email] Routing digest failed for ${sentToLabel}:`, message);
            }
          }
        }
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
