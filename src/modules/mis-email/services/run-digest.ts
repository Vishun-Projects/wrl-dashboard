import { queryUserAuth } from '@/lib/auth/user-auth-query';
import {
  hasMisEmailSendAccess,
  MIS_EMAIL_SEND_PERMISSION,
  resolveMisEmailReportIncludes,
} from '@/lib/auth/rbac-catalog';
import { buildMisEmailPayload } from '@/modules/mis-email/services/compose-digest';
import type { DigestDateRange } from '@/modules/mis-email/services/fetch-digest-data';
import { MIS_EMAIL_BODY_LAYOUT_PRESETS } from '@/modules/mis-email/services/email-body-layout';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  defaultPreferencesForRecipient,
  parseMisEmailKeyAccountsInBody,
  resolveMisEmailSendTimeIst,
  resolveDigestDateRangeForPreferences,
  resolvePersonalDigestTargets,
  shouldSendMisEmailNow,
} from '@/modules/mis-email/services/preferences';
import {
  loadAppUserProfileByEmail,
  loadDigestRecipientById,
  loadDigestRecipientByEmail,
  loadDigestRecipients,
  type DigestRecipient,
} from '@/modules/mis-email/services/recipients';
import { sendDigestEmail } from '@/modules/mis-email/services/send';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import {
  hasSuccessfulRoutingSendInSlot,
  listMisEmailRoutingRules,
  logMisEmailRoutingSendAttempt,
  resolveOfficeIdsForRoutingRule,
  resolveRoutingScheduleSlotStart,
  shouldTriggerRoutingRuleNow,
  type MisEmailRoutingRule,
} from '@/modules/mis-email/services/routing-rules';
import { logAction } from '@/lib/security/audit';

/** Stable UUID for routing compose/log rows (not a real app_users id). */
const ROUTING_COMPOSER_USER_ID = '00000000-0000-4000-8000-000000000001';

const DIGEST_SYSTEM_ACTOR = {
  userId: null,
  email: 'system:mis-email-digest',
  name: 'MIS email digest',
};

function clientsFromRoutingRule(clientCsv: string): string[] {
  return parseMisEmailKeyAccountsInBody(
    clientCsv
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function buildRoutingComposerRecipient(
  officeIds: string[],
  dateRange: DigestRecipient['mis_email_preferences']['dateRange'],
  clientCsv = ''
): DigestRecipient {
  const seesAll = officeIds.length === 0;
  const clients = clientsFromRoutingRule(clientCsv);
  // Same body defaults as enabling MIS email for a user (regional + branch + key account tables).
  const prefs = defaultPreferencesForRecipient(
    { includeSummary: true, includeDetailed: true, includeKeyAccount: true },
    { dateRange: dateRange ?? DEFAULT_MIS_EMAIL_PREFERENCES.dateRange }
  );
  return {
    id: ROUTING_COMPOSER_USER_ID,
    name: 'MIS routing',
    email: 'system:mis-email-routing@internal',
    role: seesAll ? 'hod' : 'branch_manager',
    office_ids: officeIds,
    visible_statuses: [],
    permissions: [
      MIS_EMAIL_SEND_PERMISSION,
      'tab_mis_summary',
      'tab_mis_register',
      'tab_mis_accounts',
      ...(seesAll ? (['view_all_offices'] as const) : []),
    ],
    includeSummary: true,
    includeDetailed: true,
    includeKeyAccount: true,
    mis_email_enabled: true,
    mis_email_preferences: {
      ...prefs,
      includeSummary: false,
      includeDetailed: false,
      includeKeyAccount: false,
      includeTraceableExport: false,
      // Send only WRL BD MIS Open Calls export workbook
      includeOpenCallsExport: true,
      // Custom grid (regional+branch left, key accounts right) — not stacked default.
      bodyLayout: MIS_EMAIL_BODY_LAYOUT_PRESETS.legacy_dashboard.layout,
      // Empty = all clients in branch/zone scope; otherwise only these accounts.
      keyAccountsInBody: clients,
    },
  };
}

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
    /** Always compose as this recipient (rule-driven scope); do not swap in To-user profile. */
    composeAs?: DigestRecipient;
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
  const { effectiveRecipient, displayName } = options.composeAs
    ? { effectiveRecipient: options.composeAs, displayName: options.composeAs.name }
    : await resolveSendContext(recipient, primaryTo);
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
  const org = await getMisEmailOrgSettings();

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

  // Personal digests — user Profile schedule only.
  for (let i = 0; i < recipients.length; i++) {
    await sendPersonalForRecipient(recipients[i]);
    if (i < recipients.length - 1) await delay(SEND_DELAY_MS);
  }

  // Routing digests — rule schedule + rule To/Cc. Zone/Branch = report filter only.
  async function sendRoutingRule(rule: MisEmailRoutingRule): Promise<void> {
    const ruleLabel = `${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'}`;
    if (!rule.autoSendEnabled) {
      skipped.push({
        recipientId: ROUTING_COMPOSER_USER_ID,
        reason: `Routing auto-send off (${ruleLabel})`,
      });
      return;
    }
    if (
      !shouldTriggerRoutingRuleNow(rule, {
        windowMinutes: scheduleWindowMinutes,
      })
    ) {
      skipped.push({
        recipientId: ROUTING_COMPOSER_USER_ID,
        reason: `Routing rule not due now (rule anchor ${rule.scheduleAnchorTimeIst} · every ${rule.scheduleIntervalMinutes}m)`,
      });
      return;
    }
    const slotStart = resolveRoutingScheduleSlotStart(rule);
    if (
      await hasSuccessfulRoutingSendInSlot({
        ruleId: rule.id,
        since: slotStart,
      })
    ) {
      skipped.push({
        recipientId: ROUTING_COMPOSER_USER_ID,
        reason: `Routing already sent for this schedule slot (since ${slotStart.toISOString()} · rule ${rule.scheduleAnchorTimeIst} IST)`,
      });
      return;
    }
    const toEmails = [...new Set(rule.toEmails.map((email) => email.trim()).filter(Boolean))];
    if (toEmails.length === 0) {
      skipped.push({
        recipientId: ROUTING_COMPOSER_USER_ID,
        reason: `Routing rule has no To recipients (${ruleLabel})`,
      });
      return;
    }
    const ccEmails = [...new Set(rule.ccEmails.map((email) => email.trim()).filter(Boolean))];
    const sentToLabel = toEmails.join(', ');
    const officeIds = await resolveOfficeIdsForRoutingRule(rule);
    const composer = buildRoutingComposerRecipient(
      officeIds,
      org.defaultDateRange,
      rule.client
    );
    try {
      const result = await sendForRecipient(composer, {
        to: toEmails,
        cc: ccEmails,
        composeAs: composer,
      });
      sent.push(result);
      await logMisEmailRoutingSendAttempt({
        ruleId: rule.id,
        recipientId: ROUTING_COMPOSER_USER_ID,
        recipientEmail: toEmails[0],
        sentTo: sentToLabel,
        status: 'sent',
      });
      await auditDigestSend({
        ok: true,
        sentTo: sentToLabel,
        recipientId: ROUTING_COMPOSER_USER_ID,
        attachmentCount: result.attachments.length,
        dateRangeLabel: result.dateRange.label,
        ruleId: rule.id,
      });
      console.log(
        `[mis-email] Routing digest to ${sentToLabel}${ccEmails.length ? ` cc ${ccEmails.join(', ')}` : ''} (${result.attachments.length} attachments, ${result.dateRange.label})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({
        recipientId: ROUTING_COMPOSER_USER_ID,
        email: sentToLabel,
        error: message,
      });
      await logMisEmailRoutingSendAttempt({
        ruleId: rule.id,
        recipientId: ROUTING_COMPOSER_USER_ID,
        recipientEmail: toEmails[0],
        sentTo: sentToLabel,
        status: 'failed',
        error: message,
      });
      await auditDigestSend({
        ok: false,
        sentTo: sentToLabel,
        recipientId: ROUTING_COMPOSER_USER_ID,
        ruleId: rule.id,
        error: message,
      });
      console.error(`[mis-email] Routing digest failed for ${sentToLabel}:`, message);
    }
  }

  for (let i = 0; i < routingRules.length; i++) {
    await sendRoutingRule(routingRules[i]);
    if (i < routingRules.length - 1) await delay(SEND_DELAY_MS);
  }

  if (recipients.length === 0 && routingRules.length === 0) {
    skipped.push({ recipientId: '-', reason: 'No eligible recipients or routing rules' });
  }

  return {
    sent,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };
}
