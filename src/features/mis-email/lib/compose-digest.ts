import { buildDigestAttachments, resolveDigestAttachmentFilenames, type EmailAttachment } from '@/features/mis-email/lib/build-attachments';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  countKeyAccountBodyRows,
  resolveDigestBodySections,
  type MisEmailBodyContext,
} from '@/features/mis-email/lib/body-sections';
import {
  resolveDigestKeyAccountBodyRows,
} from '@/features/mis-email/lib/fetch-digest-accounts';
import {
  buildMisEmailBranchPerformanceRowsFromTrace,
  buildMisEmailRegionalPerformanceRows,
} from '@/features/mis-email/lib/mail-basis';
import { buildDigestTraceableExportPayload } from '@/features/mis-email/lib/fetch-digest-trace';
import {
  fetchDigestRegisterRows,
  type DigestDateRange,
} from '@/features/mis-email/lib/fetch-digest-data';
import {
  fetchDigestClientAccountSummaryCached,
  fetchDigestSummaryDataCached,
} from '@/features/mis-email/lib/digest-cache';
import {
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatDigestSubject,
  formatReportPeriod,
} from '@/features/mis-email/lib/email-template';
import {
  DEFAULT_MIS_EMAIL_PREFERENCES,
  hasAnyEffectiveDigestInclude,
  mergeMisEmailPreferences,
  parseMisEmailKeyAccountsByZone,
  parseMisEmailKeyAccountsInBody,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  resolveMisEmailBodyLayoutFromPrefs,
  resolveMisEmailCcEmails,
  resolveMisEmailToEmails,
  type MisEmailBodyPermissions,
  type MisEmailPreferences,
} from '@/features/mis-email/lib/preferences';
import type { DigestRecipient } from '@/features/mis-email/lib/recipients';
import { resolvePortalUrl, sendPreparedDigestEmail } from '@/features/mis-email/lib/send';
import { resolveUserDigestScope } from '@/features/mis-email/lib/user-scope';
import {
  listMatchingMisEmailRoutingRulesForResolvedClients,
  listMisEmailRoutingRules,
  resolveRoutingClientNamesForScope,
  resolveRoutingScopeForOfficeIds,
} from '@/features/mis-email/lib/routing-rules';
import { resolveUserDigestScopeWithLabel } from '@/features/mis-email/lib/user-scope';
import { formatBytes, MisEmailTimer, type MisEmailTimingReport } from '@/features/mis-email/lib/timing';
import {
  gmailClipWarningMessage,
  measureHtmlUtf8Bytes,
} from '@/features/mis-email/lib/email-html-size';
import type { MisEmailBodyLayout } from '@/features/mis-email/lib/email-body-layout';
import type { MisEmailBodySectionId } from '@/features/mis-email/lib/body-sections';

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
  const toEmails = resolveMisEmailToEmails(preferences);
  if (toEmails.length > 0) return toEmails;
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
  clientAccountSummary?: Awaited<ReturnType<typeof fetchDigestClientAccountSummaryCached>>,
  traceRows?: Awaited<ReturnType<typeof buildDigestTraceableExportPayload>>['traceRows']
): Promise<MisEmailBodyContext> {
  const explicitAccounts = parseMisEmailKeyAccountsInBody(prefs.keyAccountsInBody);
  const explicitAccountsByZone = parseMisEmailKeyAccountsByZone(prefs.keyAccountsByZone);

  const context: MisEmailBodyContext = {
    summary: data,
    keyAccountsInBody: explicitAccounts,
    keyAccountsByZone: explicitAccountsByZone,
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
        explicitAccounts,
        explicitAccountsByZone
      );
      context.accountRows = accountRows;
      context.keyAccountsInBody = accountRows.map((row) => String(row.account ?? ''));
    }
  }

  if (bodySectionIds.includes('branch_performance') && traceRows?.length) {
    context.branchPerformanceRows = buildMisEmailBranchPerformanceRowsFromTrace(traceRows);
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

  // Always include all key-account rows. Gmail (~102 KB) may clip HTML for Gmail
  // inboxes; Outlook and most corporate mail do not — truncation was hiding rows
  // from the primary audience (WRL Outlook).
  const rendered = render();
  const htmlSizeBytes = measureHtmlUtf8Bytes(rendered.html);

  return {
    ...rendered,
    htmlSizeBytes,
    gmailClipWarning: gmailClipWarningMessage(htmlSizeBytes) || undefined,
    keyAccountRowsInBody: totalKeyRows > 0 ? totalKeyRows : undefined,
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

  timer.step('resolve preferences', `${dateRange.label} · summary=${effectiveIncludes.includeSummary} detailed=${effectiveIncludes.includeDetailed} keyAccount=${effectiveIncludes.includeKeyAccount} trace=${effectiveIncludes.includeTraceableExport} open=${effectiveIncludes.includeOpenCallsExport}`);

  const scope = await timer.measure('resolve scope', () =>
    resolveUserDigestScopeWithLabel(effectiveRecipient)
  );
  const bodyPermissions: MisEmailBodyPermissions = {
    includeSummary: effectiveRecipient.includeSummary,
    includeKeyAccount: effectiveRecipient.includeKeyAccount,
  };
  const bodySectionIds = resolveDigestBodySections(bodyPermissions, prefs, {
    includeKeyAccountAttachment: false,
  });
  if (!hasAnyEffectiveDigestInclude(effectiveIncludes) && bodySectionIds.length === 0) {
    throw new Error('Select at least one report attachment');
  }
  const needsClientAccounts =
    bodySectionIds.includes('key_account_performance') ||
    bodySectionIds.includes('regional_performance');
  const includeDetailed = !options.forPreview && effectiveIncludes.includeDetailed;
  const includeTraceableExport =
    !options.forPreview && effectiveIncludes.includeTraceableExport;
  const includeOpenCallsExport =
    !options.forPreview && effectiveIncludes.includeOpenCallsExport;
  // Send: branch body uses Cadbury-safe call-level trace (CRM Cadbury out, Mondelez import in).
  // Preview: skip that path — Year-to-yesterday pulls ~250k call rows and takes minutes.
  // Preview falls back to CRM branchSummary; send still builds the accurate trace.
  const needsTraceForBody =
    !options.forPreview && bodySectionIds.includes('branch_performance');
  const needsClientAccountData =
    needsClientAccounts ||
    includeTraceableExport ||
    includeOpenCallsExport ||
    needsTraceForBody;

  timer.step(
    'plan data fetch',
    `sections=${bodySectionIds.join(',') || 'none'} · clientAccounts=${needsClientAccountData} · register=${includeDetailed} · trace=${includeTraceableExport || includeOpenCallsExport || needsTraceForBody}`
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

  const tracePayload = includeTraceableExport || includeOpenCallsExport || needsTraceForBody
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

  if (attachmentFilenames.length === 0 && bodySectionIds.length === 0) {
    throw new Error('No report content selected');
  }

  const bodyContext = await timer.measure('build body context', async () =>
    buildMisEmailBodyContext(
      prefs,
      bodyPermissions,
      data,
      dateRange,
      bodySectionIds,
      clientAccountSummary,
      tracePayload?.traceRows
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
      subject: formatDigestSubject(dateRange.endDate),
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
    sendCc?: string[];
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
        cc: resolveMisEmailCcEmails(prefs),
        autoSendEnabled: true,
      };
  if (!routing.autoSendEnabled && options.allowAutoSendDisabledOverride !== true) {
    throw new Error('Auto-send disabled by HOD routing rule for this scope');
  }
  const targets = options.sendTo?.length
    ? explicitTargets
    : [...new Set(routing.to.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const ccTargets = options.sendTo?.length
    ? [
        ...new Set(
          (options.sendCc ?? [])
            .map((email) => email.trim().toLowerCase())
            .filter((email) => email && !targets.includes(email))
        ),
      ]
    : [
        ...new Set(
          routing.cc
            .map((email) => email.trim().toLowerCase())
            .filter((email) => email && !targets.includes(email))
        ),
      ];
  if (targets.length === 0) {
    throw new Error('Add at least one recipient email');
  }

  batchTimer.step(
    'resolve recipients',
    `${targets.length} to · ${ccTargets.length} cc`
  );

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
  const emailBody = {
    recipientName: options.displayName?.trim() || recipient.name,
    recipientEmail: primaryTarget,
    dateRange,
    scopeLabel,
    portalUrl,
    bodyHtml,
    bodyPlainText,
  };

  const sentToLabel = targets.join(', ');
  const { messageId } = await batchTimer.measure(`smtp send → ${sentToLabel}`, () =>
    sendPreparedDigestEmail({
      to: targets.length === 1 ? targets[0] : targets,
      cc: ccTargets.length ? ccTargets : undefined,
      subject: preview.subject,
      html: buildDigestEmailHtml(emailBody),
      text: buildDigestEmailPlainText(emailBody),
      attachments: emailAttachments,
    })
  );

  const results: MisEmailSendResult[] = [
    {
      sentTo: sentToLabel,
      attachments: preview.attachments,
      scopeLabel,
      messageId,
      dateRange,
      timing: buildTiming,
    },
  ];

  const batchTiming = batchTimer.finish(
    `recipients=${targets.length} to · ${ccTargets.length} cc`
  );
  results[0].timing = batchTiming;

  return results;
}
