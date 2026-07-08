import { buildDigestAttachments, resolveDigestAttachmentFilenames, type EmailAttachment } from '@/lib/mis-email/build-attachments';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  resolveDigestBodySections,
  type MisEmailBodyContext,
} from '@/lib/mis-email/body-sections';
import {
  resolveDigestKeyAccountBodyRows,
} from '@/lib/mis-email/fetch-digest-accounts';
import {
  fetchDigestRegisterRows,
  type DigestDateRange,
} from '@/lib/mis-email/fetch-digest-data';
import {
  fetchDigestClientAccountSummaryCached,
  fetchDigestSummaryDataCached,
} from '@/lib/mis-email/digest-cache';
import {
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatReportPeriod,
} from '@/lib/mis-email/email-template';
import {
  hasAnyEffectiveDigestInclude,
  mergeMisEmailPreferences,
  parseMisEmailKeyAccountsInBody,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  type MisEmailBodyPermissions,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import { resolvePortalUrl, sendPreparedDigestEmail } from '@/lib/mis-email/send';
import { resolveUserDigestScopeWithLabel } from '@/lib/mis-email/user-scope';
import { formatBytes, MisEmailTimer, type MisEmailTimingReport } from '@/lib/mis-email/timing';

export type MisEmailComposePreview = {
  subject: string;
  scopeLabel: string;
  dateRange: DigestDateRange;
  dateRangeLabel: string;
  attachments: string[];
  html: string;
  plainText: string;
};

export type MisEmailSendResult = {
  sentTo: string;
  attachments: string[];
  scopeLabel: string;
  messageId: string;
  dateRange: DigestDateRange;
  timing?: MisEmailTimingReport;
};

function formatDigestSubject(date = new Date()): string {
  return `WRL MIS Reports — ${date.toISOString().split('T')[0]}`;
}

function recipientWithPreferences(
  recipient: DigestRecipient,
  preferences?: MisEmailPreferences
): DigestRecipient {
  if (!preferences) return recipient;
  return {
    ...recipient,
    mis_email_preferences: mergeMisEmailPreferences(recipient.mis_email_preferences, preferences),
  };
}

export function resolveMisEmailSendTargets(
  recipient: DigestRecipient,
  preferences: MisEmailPreferences,
  override?: string[]
): string[] {
  if (override?.length) {
    return [...new Set(override.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
  }
  return [
    recipient.email.trim().toLowerCase(),
    ...resolveExtraDigestEmails(preferences, recipient.email),
  ];
}

async function buildMisEmailBodyContext(
  prefs: MisEmailPreferences,
  bodyPermissions: MisEmailBodyPermissions,
  data: Awaited<ReturnType<typeof fetchDigestSummaryDataCached>>,
  dateRange: DigestDateRange,
  bodySectionIds: ReturnType<typeof resolveDigestBodySections>,
  clientAccountSummary?: Awaited<ReturnType<typeof fetchDigestClientAccountSummaryCached>>
): Promise<MisEmailBodyContext> {
  const explicitAccounts = parseMisEmailKeyAccountsInBody(prefs.keyAccountsInBody);

  const context: MisEmailBodyContext = {
    summary: data,
    keyAccountsInBody: explicitAccounts,
  };

  if (bodySectionIds.includes('key_account_performance')) {
    const clientRows =
      clientAccountSummary !== undefined
        ? clientAccountSummary
        : await fetchDigestClientAccountSummaryCached(dateRange);
    const accountRows = resolveDigestKeyAccountBodyRows(
      data.accountSummary,
      clientRows,
      explicitAccounts
    );
    context.clientAccountSummary = clientRows as Array<Record<string, unknown>>;
    context.accountRows = accountRows;
    context.keyAccountsInBody = accountRows.map((row) => String(row.account ?? ''));
  }

  return context;
}

export async function buildMisEmailPayload(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    sentTo: string;
    displayName: string;
    dateRange?: DigestDateRange;
    /** Skip register fetch and Excel generation — preview only needs HTML + filenames. */
    forPreview?: boolean;
    timer?: MisEmailTimer;
  }
): Promise<{
  preview: MisEmailComposePreview;
  emailAttachments: EmailAttachment[];
  dateRange: DigestDateRange;
  scopeLabel: string;
  bodyHtml?: string;
  bodyPlainText?: string;
  timing?: MisEmailTimingReport;
}> {
  const timer = options.timer ?? new MisEmailTimer(options.forPreview ? 'build-preview' : 'build-send');
  const ownTimer = !options.timer;

  const effectiveRecipient = recipientWithPreferences(recipient, options.preferences);
  const prefs = effectiveRecipient.mis_email_preferences;
  const dateRange =
    options.dateRange ?? resolveDigestDateRangeForPreferences(prefs);
  const effectiveIncludes = resolveEffectiveDigestIncludes(effectiveRecipient, prefs);

  if (!hasAnyEffectiveDigestInclude(effectiveIncludes)) {
    throw new Error('Select at least one report attachment');
  }

  timer.step('resolve preferences', `${dateRange.label} · summary=${effectiveIncludes.includeSummary} detailed=${effectiveIncludes.includeDetailed} keyAccount=${effectiveIncludes.includeKeyAccount}`);

  const scope = await timer.measure('resolve scope', () =>
    resolveUserDigestScopeWithLabel(effectiveRecipient)
  );
  const bodyPermissions: MisEmailBodyPermissions = {
    includeSummary: effectiveIncludes.includeSummary,
    includeKeyAccount: effectiveIncludes.includeKeyAccount,
  };
  const bodySectionIds = resolveDigestBodySections(bodyPermissions, prefs, {
    includeKeyAccountAttachment: effectiveIncludes.includeKeyAccount,
  });
  const needsClientAccounts = bodySectionIds.includes('key_account_performance');
  const includeDetailed = !options.forPreview && effectiveIncludes.includeDetailed;

  timer.step('plan data fetch', `sections=${bodySectionIds.join(',') || 'none'} · clientAccounts=${needsClientAccounts} · register=${includeDetailed}`);

  const data = await timer.measure('fetch summary', () => fetchDigestSummaryDataCached(scope, dateRange), (result) =>
    `branches=${result.branchSummary.length} accounts=${result.accountSummary.length}`
  );

  let clientAccountSummary: Awaited<ReturnType<typeof fetchDigestClientAccountSummaryCached>> | undefined;
  if (needsClientAccounts) {
    try {
      clientAccountSummary = await timer.measure(
        'fetch client accounts',
        () => fetchDigestClientAccountSummaryCached(dateRange),
        (rows) => `rows=${rows.length}`
      );
    } catch (err: unknown) {
      if (options.forPreview) {
        clientAccountSummary = [];
        const reason = err instanceof Error ? err.message : 'unavailable';
        timer.step('fetch client accounts', `CRM only in preview (${reason})`);
      } else {
        throw err;
      }
    }
  }

  const registerRows = includeDetailed
    ? await timer.measure('fetch register rows', () =>
        fetchDigestRegisterRows(effectiveRecipient, scope, dateRange), (rows) => `rows=${rows.length}`
      )
    : undefined;

  let emailAttachments: EmailAttachment[];
  let attachmentFilenames: string[];

  if (options.forPreview) {
    attachmentFilenames = resolveDigestAttachmentFilenames(effectiveIncludes);
    emailAttachments = [];
    timer.step('preview filenames only', `${attachmentFilenames.length} files`);
  } else {
    emailAttachments = await timer.measure('build attachments', () =>
      buildDigestAttachments(effectiveRecipient, data, {
        registerRows,
        effectiveIncludes,
      }), (attachments) =>
        attachments
          .map((file) => `${file.filename} ${formatBytes(file.content.length)}`)
          .join('; ')
    );
    attachmentFilenames = emailAttachments.map((a) => a.filename);
  }

  if (attachmentFilenames.length === 0) {
    throw new Error('No attachments generated for your report permissions');
  }

  const bodyContext = await timer.measure('build body context', async () =>
    buildMisEmailBodyContext(
      prefs,
      bodyPermissions,
      data,
      dateRange,
      bodySectionIds,
      clientAccountSummary
    ), (ctx) => `accountRows=${ctx.accountRows?.length ?? 0}`
  );

  const bodyHtml =
    bodySectionIds.length > 0
      ? buildEmailBodySectionsHtml(bodySectionIds, bodyContext)
      : undefined;
  const bodyPlainText =
    bodySectionIds.length > 0
      ? buildEmailBodySectionsPlainText(bodySectionIds, bodyContext)
      : undefined;
  timer.step('render body html', bodyHtml ? `${bodyHtml.length} chars` : 'none');

  const portalUrl = resolvePortalUrl();
  const emailParams = {
    recipientName: options.displayName,
    recipientEmail: options.sentTo,
    dateRange,
    scopeLabel: scope.scopeLabel,
    portalUrl,
    bodyHtml,
    bodyPlainText: bodyPlainText,
  };

  const timing = ownTimer ? timer.finish() : undefined;

  return {
    preview: {
      subject: formatDigestSubject(),
      scopeLabel: scope.scopeLabel,
      dateRange,
      dateRangeLabel: formatReportPeriod(dateRange),
      attachments: attachmentFilenames,
      html: buildDigestEmailHtml(emailParams),
      plainText: buildDigestEmailPlainText(emailParams),
    },
    emailAttachments,
    dateRange,
    scopeLabel: scope.scopeLabel,
    bodyHtml,
    bodyPlainText,
    timing,
  };
}

export async function previewMisEmailCompose(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    displayName?: string;
  }
): Promise<MisEmailComposePreview> {
  const sentTo = recipient.email.trim().toLowerCase();
  const { preview } = await buildMisEmailPayload(recipient, {
    preferences: options.preferences,
    sentTo,
    displayName: options.displayName?.trim() || recipient.name,
    forPreview: true,
  });
  return preview;
}

export async function sendMisEmailCompose(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    sentTo: string;
    displayName?: string;
  }
): Promise<MisEmailSendResult> {
  const sentTo = options.sentTo.trim().toLowerCase();
  const displayName = options.displayName?.trim() || recipient.name;
  const { preview, emailAttachments, dateRange, scopeLabel, bodyHtml, bodyPlainText } =
    await buildMisEmailPayload(recipient, {
      preferences: options.preferences,
      sentTo,
      displayName,
    });

  const portalUrl = resolvePortalUrl();
  const emailBody = {
    recipientName: displayName,
    recipientEmail: sentTo,
    dateRange,
    scopeLabel,
    portalUrl,
    bodyHtml,
    bodyPlainText,
  };

  const { messageId } = await sendPreparedDigestEmail({
    to: sentTo,
    subject: preview.subject,
    html: buildDigestEmailHtml(emailBody),
    text: buildDigestEmailPlainText(emailBody),
    attachments: emailAttachments,
  });

  return {
    sentTo,
    attachments: preview.attachments,
    scopeLabel,
    messageId,
    dateRange,
  };
}

export async function sendMisEmailComposeBatch(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    sendTo?: string[];
    displayName?: string;
  }
): Promise<MisEmailSendResult[]> {
  const batchTimer = new MisEmailTimer('send-batch');
  const prefs = mergeMisEmailPreferences(
    recipient.mis_email_preferences,
    options.preferences ?? {}
  );
  const targets = resolveMisEmailSendTargets(recipient, prefs, options.sendTo);
  if (targets.length === 0) {
    throw new Error('Add at least one recipient email');
  }

  batchTimer.step('resolve recipients', `${targets.length} inbox(es)`);

  const primaryTarget = targets[0];
  const {
    preview,
    emailAttachments,
    dateRange,
    scopeLabel,
    bodyHtml,
    bodyPlainText,
    timing: buildTiming,
  } = await buildMisEmailPayload(recipient, {
    preferences: options.preferences,
    sentTo: primaryTarget,
    displayName: options.displayName?.trim() || recipient.name,
    timer: batchTimer,
  });

  const portalUrl = resolvePortalUrl();
  const results: MisEmailSendResult[] = [];

  for (const sentTo of targets) {
    const emailBody = {
      recipientName: options.displayName?.trim() || recipient.name,
      recipientEmail: sentTo,
      dateRange,
      scopeLabel,
      portalUrl,
      bodyHtml,
      bodyPlainText,
    };

    const { messageId } = await batchTimer.measure(`smtp send → ${sentTo}`, () =>
      sendPreparedDigestEmail({
        to: sentTo,
        subject: preview.subject,
        html: buildDigestEmailHtml(emailBody),
        text: buildDigestEmailPlainText(emailBody),
        attachments: emailAttachments,
      })
    );

    results.push({
      sentTo,
      attachments: preview.attachments,
      scopeLabel,
      messageId,
      dateRange,
      timing: buildTiming,
    });
  }

  const batchTiming = batchTimer.finish(`recipients=${targets.length}`);
  if (results[0]) {
    results[0].timing = batchTiming;
  }

  return results;
}
