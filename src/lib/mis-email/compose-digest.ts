import { buildDigestAttachments, resolveDigestAttachmentFilenames, type EmailAttachment } from '@/lib/mis-email/build-attachments';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  countKeyAccountBodyRows,
  resolveDigestBodySections,
  type MisEmailBodyContext,
} from '@/lib/mis-email/body-sections';
import {
  resolveDigestKeyAccountBodyRows,
} from '@/lib/mis-email/fetch-digest-accounts';
import { buildMisEmailRegionalPerformanceRows } from '@/lib/mis-email/mail-basis';
import { buildDigestTraceableExportPayload } from '@/lib/mis-email/fetch-digest-trace';
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
  DEFAULT_MIS_EMAIL_PREFERENCES,
  hasAnyEffectiveDigestInclude,
  mergeMisEmailPreferences,
  parseMisEmailKeyAccountsInBody,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  resolveMisEmailBodyLayoutFromPrefs,
  type MisEmailBodyPermissions,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import { resolvePortalUrl, sendPreparedDigestEmail } from '@/lib/mis-email/send';
import { resolveUserDigestScope } from '@/lib/mis-email/user-scope';
import {
  listMatchingMisEmailRoutingRulesForResolvedClients,
  listMisEmailRoutingRules,
  resolveRoutingClientNamesForScope,
  resolveRoutingScopeForOfficeIds,
} from '@/lib/mis-email/routing-rules';
import { resolveUserDigestScopeWithLabel } from '@/lib/mis-email/user-scope';
import { formatBytes, MisEmailTimer, type MisEmailTimingReport } from '@/lib/mis-email/timing';
import {
  GMAIL_SAFE_HTML_BYTES,
  gmailClipWarningMessage,
  measureHtmlUtf8Bytes,
} from '@/lib/mis-email/email-html-size';
import type { MisEmailBodyLayout } from '@/lib/mis-email/email-body-layout';
import type { MisEmailBodySectionId } from '@/lib/mis-email/body-sections';

export type MisEmailComposePreview = {
  subject: string;
  scopeLabel: string;
  dateRange: DigestDateRange;
  dateRangeLabel: string;
  attachments: string[];
  html: string;
  plainText: string;
  htmlSizeBytes?: number;
  gmailClipWarning?: string;
  keyAccountRowsInBody?: number;
  keyAccountRowsTotal?: number;
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

  if (
    bodySectionIds.includes('key_account_performance') ||
    bodySectionIds.includes('regional_performance')
  ) {
    const clientRows =
      clientAccountSummary !== undefined
        ? clientAccountSummary
        : await fetchDigestClientAccountSummaryCached(dateRange);
    context.clientAccountSummary = clientRows as Array<Record<string, unknown>>;
    if (bodySectionIds.includes('regional_performance')) {
      context.regionalPerformanceRows = buildMisEmailRegionalPerformanceRows(
        data,
        clientRows
      );
    }
    if (bodySectionIds.includes('key_account_performance')) {
      const accountRows = resolveDigestKeyAccountBodyRows(
        data.accountSummary,
        clientRows,
        explicitAccounts
      );
      context.accountRows = accountRows;
      context.keyAccountsInBody = accountRows.map((row) => String(row.account ?? ''));
    }
  }

  return context;
}

function buildDigestEmailContent(params: {
  recipientName: string;
  recipientEmail: string;
  dateRange: DigestDateRange;
  scopeLabel: string;
  portalUrl: string;
  bodySectionIds: MisEmailBodySectionId[];
  bodyContext: MisEmailBodyContext;
  bodyLayout: MisEmailBodyLayout;
  forPreview?: boolean;
}): {
  bodyHtml?: string;
  bodyPlainText?: string;
  html: string;
  plainText: string;
  htmlSizeBytes: number;
  gmailClipWarning?: string;
  keyAccountRowsInBody?: number;
  keyAccountRowsTotal?: number;
} {
  const { bodySectionIds, bodyContext, bodyLayout } = params;
  const totalKeyRows = bodySectionIds.includes('key_account_performance')
    ? countKeyAccountBodyRows(bodyContext)
    : 0;

  const render = (keyAccountMaxRows?: number) => {
    const bodyHtml =
      bodySectionIds.length > 0
        ? buildEmailBodySectionsHtml(bodySectionIds, bodyContext, {
            layout: bodyLayout,
            keyAccountMaxRows,
          })
        : undefined;
    const bodyPlainText =
      bodySectionIds.length > 0
        ? buildEmailBodySectionsPlainText(bodySectionIds, bodyContext)
        : undefined;
    const emailParams = {
      recipientName: params.recipientName,
      recipientEmail: params.recipientEmail,
      dateRange: params.dateRange,
      scopeLabel: params.scopeLabel,
      portalUrl: params.portalUrl,
      bodyHtml,
      bodyPlainText,
    };
    return {
      bodyHtml,
      bodyPlainText,
      html: buildDigestEmailHtml(emailParams, { forPreview: params.forPreview }),
      plainText: buildDigestEmailPlainText(emailParams),
    };
  };

  let keyAccountMaxRows: number | undefined;
  let rendered = render();
  let htmlSizeBytes = measureHtmlUtf8Bytes(rendered.html);

  if (
    htmlSizeBytes > GMAIL_SAFE_HTML_BYTES &&
    totalKeyRows > 0 &&
    bodySectionIds.includes('key_account_performance')
  ) {
    let lo = 0;
    let hi = totalKeyRows;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const trialBytes = measureHtmlUtf8Bytes(render(mid).html);
      if (trialBytes <= GMAIL_SAFE_HTML_BYTES) lo = mid;
      else hi = mid - 1;
    }
    if (lo === 0) {
      // Truncation cannot make this email fit Gmail-safe size; avoid blanking key-account rows.
      // Keep full body content and rely on Gmail clipping warning/attached Excel.
    } else if (lo < totalKeyRows) {
      keyAccountMaxRows = lo;
      rendered = render(keyAccountMaxRows);
      htmlSizeBytes = measureHtmlUtf8Bytes(rendered.html);
    }
  }

  const rowsShown =
    keyAccountMaxRows !== undefined ? keyAccountMaxRows : totalKeyRows;

  return {
    ...rendered,
    htmlSizeBytes,
    gmailClipWarning: gmailClipWarningMessage(htmlSizeBytes) || undefined,
    keyAccountRowsInBody: totalKeyRows > 0 ? rowsShown : undefined,
    keyAccountRowsTotal: totalKeyRows > 0 ? totalKeyRows : undefined,
  };
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

  timer.step('resolve preferences', `${dateRange.label} · summary=${effectiveIncludes.includeSummary} detailed=${effectiveIncludes.includeDetailed} keyAccount=${effectiveIncludes.includeKeyAccount} trace=${effectiveIncludes.includeTraceableExport}`);

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
  const needsClientAccounts =
    bodySectionIds.includes('key_account_performance') ||
    bodySectionIds.includes('regional_performance');
  const includeDetailed = !options.forPreview && effectiveIncludes.includeDetailed;
  const includeTraceableExport =
    !options.forPreview && effectiveIncludes.includeTraceableExport;
  const needsClientAccountData = needsClientAccounts || includeTraceableExport;

  timer.step(
    'plan data fetch',
    `sections=${bodySectionIds.join(',') || 'none'} · clientAccounts=${needsClientAccountData} · register=${includeDetailed} · trace=${includeTraceableExport || effectiveIncludes.includeTraceableExport}`
  );

  const data = await timer.measure('fetch summary', () => fetchDigestSummaryDataCached(scope, dateRange), (result) =>
    `branches=${result.branchSummary.length} accounts=${result.accountSummary.length}`
  );

  let clientAccountSummary: Awaited<ReturnType<typeof fetchDigestClientAccountSummaryCached>> | undefined;
  if (needsClientAccountData) {
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

  const tracePayload = includeTraceableExport
    ? await timer.measure('build trace export', () =>
        buildDigestTraceableExportPayload(
          scope,
          dateRange,
          data,
          clientAccountSummary ?? []
        ), (payload) => `traceRows=${payload.traceRows.length}`
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
        tracePayload,
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

  const bodyLayout = resolveMisEmailBodyLayoutFromPrefs(prefs);
  const portalUrl = resolvePortalUrl();
  const emailContent = buildDigestEmailContent({
    recipientName: options.displayName,
    recipientEmail: options.sentTo,
    dateRange,
    scopeLabel: scope.scopeLabel,
    portalUrl,
    bodySectionIds,
    bodyContext,
    bodyLayout,
    forPreview: options.forPreview,
  });

  timer.step(
    'render body html',
    emailContent.bodyHtml
      ? `${emailContent.bodyHtml.length} chars · ${formatBytes(emailContent.htmlSizeBytes)} total`
      : 'none'
  );

  const timing = ownTimer ? timer.finish() : undefined;

  return {
    preview: {
      subject: formatDigestSubject(),
      scopeLabel: scope.scopeLabel,
      dateRange,
      dateRangeLabel: formatReportPeriod(dateRange),
      attachments: attachmentFilenames,
      html: emailContent.html,
      plainText: emailContent.plainText,
      htmlSizeBytes: emailContent.htmlSizeBytes,
      gmailClipWarning: emailContent.gmailClipWarning,
      keyAccountRowsInBody: emailContent.keyAccountRowsInBody,
      keyAccountRowsTotal: emailContent.keyAccountRowsTotal,
    },
    emailAttachments,
    dateRange,
    scopeLabel: scope.scopeLabel,
    bodyHtml: emailContent.bodyHtml,
    bodyPlainText: emailContent.bodyPlainText,
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
    allowAutoSendDisabledOverride?: boolean;
    displayName?: string;
  }
): Promise<MisEmailSendResult[]> {
  const batchTimer = new MisEmailTimer('send-batch');
  const prefs = mergeMisEmailPreferences(
    recipient.mis_email_preferences,
    options.preferences ?? {}
  );
  const explicitTargets = resolveMisEmailSendTargets(recipient, prefs, options.sendTo);
  const dateRangeMode = prefs.dateRange ?? DEFAULT_MIS_EMAIL_PREFERENCES.dateRange;
  const digestScope = resolveUserDigestScope(recipient);
  const [rules, clientNames, officeScope] = await Promise.all([
    listMisEmailRoutingRules(),
    resolveRoutingClientNamesForScope({
      officeIds: recipient.office_ids ?? [],
      isHod: digestScope.isHod,
      dateRangeMode,
    }),
    resolveRoutingScopeForOfficeIds(recipient.office_ids ?? []),
  ]);
  const matchedRule =
    listMatchingMisEmailRoutingRulesForResolvedClients({
      rules,
      zones: officeScope.zones,
      branches: officeScope.branches,
      mailClients: clientNames.mail,
      crmClients: clientNames.crm,
    })[0] ?? null;
  const routing = matchedRule
    ? {
        matchedRule,
        to: matchedRule.toEmails,
        cc: matchedRule.ccEmails,
        autoSendEnabled: matchedRule.autoSendEnabled,
      }
    : {
        matchedRule: null,
        to: explicitTargets,
        cc: [] as string[],
        autoSendEnabled: true,
      };
  if (!routing.autoSendEnabled && options.allowAutoSendDisabledOverride !== true) {
    throw new Error('Auto-send disabled by HOD routing rule for this scope');
  }
  const targets = options.sendTo?.length
    ? explicitTargets
    : [...new Set([...routing.to, ...routing.cc])];
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
