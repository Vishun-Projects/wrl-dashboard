import { buildDigestAttachments, resolveDigestAttachmentFilenames, type EmailAttachment } from '@/modules/mis-email/services/build-attachments';
import {
  buildEmailBodySectionsHtml,
  buildEmailBodySectionsPlainText,
  buildTopLevelBranchRows,
  countKeyAccountBodyRows,
  resolveDigestBodySections,
  type MisEmailBodyContext,
} from '@/modules/mis-email/services/body-sections';
import {
  resolveDigestKeyAccountBodyRows,
} from '@/modules/mis-email/services/fetch-digest-accounts';
import {
  buildMisEmailKeyAccountRowsFromTrace,
  buildMisEmailRegionalAndBranchRowsFromTrace,
  buildMisEmailRegionalPerformanceRows,
  mergeBranchPerformanceRowsByName,
  overlayBranchOpenFromExcelRows,
  overlayRegionalOpenFromExcelRows,
  reconcileMisEmailOpenCounts,
} from '@/modules/mis-email/services/mail-basis';
import { mergeBranchSummaryRowsByName, type BdMisTraceRow } from '@/modules/mis';
import type { BranchPerformanceRow } from '@/modules/mis-email/services/mail-types';
import {
  fetchDigestRegisterRows,
  type DigestDateRange,
} from '@/modules/mis-email/services/fetch-digest-data';
import {
  buildDigestTraceableExportPayloadCached,
  fetchDigestClientAccountSummaryCached,
  fetchDigestSummaryDataCached,
} from '@/modules/mis-email/services/digest-cache';
import {
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatDigestSubject,
  formatReportPeriod,
  resolveMisEmailBrandSubtitle,
  resolveMisEmailIntroText,
  resolveMisEmailSubjectTemplate,
  type MisEmailIntroPreset,
} from '@/modules/mis-email/services/email-template';
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
} from '@/modules/mis-email/services/preferences';
import type { DigestRecipient } from '@/modules/mis-email/services/recipients';
import { resolvePortalUrl, sendPreparedDigestEmail } from '@/modules/mis-email/services/send';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import { resolveUserDigestScope } from '@/modules/mis-email/services/user-scope';
import {
  listMatchingMisEmailRoutingRulesForResolvedClients,
  listMisEmailRoutingRules,
  resolveRoutingClientNamesForScope,
  resolveRoutingScopeForOfficeIds,
} from '@/modules/mis-email/services/routing-rules';
import { resolveUserDigestScopeWithLabel } from '@/modules/mis-email/services/user-scope';
import { formatBytes, MisEmailTimer, type MisEmailTimingReport } from '@/modules/mis-email/services/timing';
import {
  gmailClipWarningMessage,
  measureHtmlUtf8Bytes,
} from '@/modules/mis-email/services/email-html-size';
import type { MisEmailBodyLayout } from '@/modules/mis-email/services/email-body-layout';
import type { MisEmailBodySectionId } from '@/modules/mis-email/services/body-sections';

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
  options?: {
    /** Full YTD trace — body counted entirely from these rows (traceable Excel on). */
    fullTraceRows?: BdMisTraceRow[];
    /** Open-calls Excel rows — open/aging overlay; solved/cancelled stay on CRM/BdMis summary. */
    openTraceRows?: BdMisTraceRow[];
  }
): Promise<MisEmailBodyContext> {
  const explicitAccounts = parseMisEmailKeyAccountsInBody(prefs.keyAccountsInBody);
  const explicitAccountsByZone = parseMisEmailKeyAccountsByZone(prefs.keyAccountsByZone);

  const context: MisEmailBodyContext = {
    summary: data,
    keyAccountsInBody: explicitAccounts,
    keyAccountsByZone: explicitAccountsByZone,
  };

  const needsKeyAccountBody = bodySectionIds.includes('key_account_performance');
  const needsRegionalBody = bodySectionIds.includes('regional_performance');
  const needsBranchBody = bodySectionIds.includes('branch_performance');
  const fullTraceRows = options?.fullTraceRows;
  const openTraceRows = options?.openTraceRows;

  if (needsKeyAccountBody || needsRegionalBody) {
    const clientRows =
      clientAccountSummary !== undefined
        ? clientAccountSummary
        : await fetchDigestClientAccountSummaryCached(dateRange);
    context.clientAccountSummary = clientRows as Array<Record<string, unknown>>;
  }

  // Yesterday morning (4cd6dee): totals from CRM/BdMis summary; opens from Excel overlay.
  // Full-trace body only when traceable Excel forced a full corpus (rare for morning mail).
  if (fullTraceRows?.length && (needsRegionalBody || needsBranchBody)) {
    const { regional, branch } = buildMisEmailRegionalAndBranchRowsFromTrace(
      fullTraceRows,
      data.branchSummary
    );
    if (needsRegionalBody) context.regionalPerformanceRows = regional;
    if (needsBranchBody) {
      context.branchPerformanceRows = mergeBranchPerformanceRowsByName(branch);
    }
  } else if (needsRegionalBody || needsBranchBody) {
    const clientRows =
      clientAccountSummary !== undefined
        ? clientAccountSummary
        : await fetchDigestClientAccountSummaryCached(dateRange);
    if (needsRegionalBody) {
      let regional = buildMisEmailRegionalPerformanceRows(data, clientRows);
      if (openTraceRows?.length) {
        regional = overlayRegionalOpenFromExcelRows(regional, openTraceRows);
      }
      context.regionalPerformanceRows = regional;
    }
    if (needsBranchBody) {
      const crmBranch: BranchPerformanceRow[] = mergeBranchSummaryRowsByName(
        buildTopLevelBranchRows(data.branchSummary)
      ).map((row) => ({
        branch: row.branch,
        region: row.region,
        total_calls: row.total_calls,
        solved_calls: row.solved_calls,
        cancelled_calls: row.cancelled_calls,
        open_calls: row.open_calls,
        age_2: row.age_2,
        age_3: row.age_3,
        age_7: row.age_7,
        age_15: row.age_15,
        part_pending: row.part_pending,
        active_eng: row.active_eng,
      }));
      context.branchPerformanceRows = openTraceRows?.length
        ? overlayBranchOpenFromExcelRows(crmBranch, openTraceRows, data.branchSummary)
        : crmBranch;
    }
  }

  if (needsKeyAccountBody) {
    if (fullTraceRows?.length) {
      const fromTrace = buildMisEmailKeyAccountRowsFromTrace(fullTraceRows);
      const accountRows = resolveDigestKeyAccountBodyRows(
        fromTrace as never,
        [],
        explicitAccounts,
        explicitAccountsByZone
      );
      context.accountRows = accountRows;
      context.keyAccountsInBody = accountRows.map((row) => String(row.account ?? ''));
      context.accountMetricsFromTrace = true;
      context.clientAccountSummary = [];
    } else {
      const clientRows =
        clientAccountSummary !== undefined
          ? clientAccountSummary
          : await fetchDigestClientAccountSummaryCached(dateRange);
      context.clientAccountSummary = clientRows as Array<Record<string, unknown>>;
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
  branding?: {
    greeting?: string;
    brandTitle?: string;
    brandSubtitle?: string;
    subjectTemplate?: string;
    introText?: string;
    introPreset?: MisEmailIntroPreset;
  };
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
      branding: params.branding,
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
    /** Manual compose intro preset; cron omits this and stays on normal. */
    introPreset?: MisEmailIntroPreset;
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
    bodySectionIds.includes('regional_performance') ||
    bodySectionIds.includes('branch_performance');
  const includeDetailed = effectiveIncludes.includeDetailed;
  const includeTraceableExport = effectiveIncludes.includeTraceableExport;
  const includeOpenCallsExport = effectiveIncludes.includeOpenCallsExport;
  const needsTraceBody =
    bodySectionIds.includes('regional_performance') ||
    bodySectionIds.includes('branch_performance') ||
    bodySectionIds.includes('key_account_performance');
  // Call-level rows only when Excel or open-overlay needs them — not full YTD for body totals.
  const needsClientAccountData =
    needsClientAccounts ||
    includeTraceableExport ||
    includeOpenCallsExport ||
    needsTraceBody;

  timer.step(
    'plan data fetch',
    `sections=${bodySectionIds.join(',') || 'none'} · clientAccounts=${needsClientAccountData} · register=${includeDetailed} · traceExcel=${includeTraceableExport} · openExcel=${includeOpenCallsExport} · traceBody=${needsTraceBody}`
  );

  const dataRaw = await timer.measure('fetch summary', () => fetchDigestSummaryDataCached(scope, dateRange), (result) =>
    `branches=${result.branchSummary.length} accounts=${result.accountSummary.length}`
  );

  const selectedAccounts = parseMisEmailKeyAccountsInBody(prefs.keyAccountsInBody);
  const data = dataRaw;
  if (selectedAccounts.length) {
    timer.step(
      'selected accounts (body only)',
      `selected=${selectedAccounts.length} · overall accounts=${data.accountSummary.length}`
    );
  }

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

  let registerRows = includeDetailed
    ? await timer.measure('fetch register rows', () =>
        fetchDigestRegisterRows(effectiveRecipient, scope, dateRange), (rows) => `rows=${rows.length}`
      )
    : undefined;

  let attachmentIncludes = effectiveIncludes;
  if (includeDetailed && registerRows !== undefined && registerRows.length === 0) {
    // No matching client rows — skip detailed workbook instead of failing the send.
    registerRows = undefined;
    attachmentIncludes = { ...effectiveIncludes, includeDetailed: false };
  }

  // Morning mail (yesterday 4cd6dee): open Excel only → open-only pull + CRM totals overlay.
  // Full YTD corpus only when traceable Excel is attached.
  const needsFullTraceCorpus = includeTraceableExport;
  const needsOpenOverlay =
    (bodySectionIds.includes('regional_performance') ||
      bodySectionIds.includes('branch_performance')) &&
    (includeOpenCallsExport || includeTraceableExport || !!options.forPreview);
  const needsTracePayload =
    includeTraceableExport || includeOpenCallsExport || needsOpenOverlay;
  const skipRepairDone =
    !!options.forPreview || !(includeTraceableExport || includeOpenCallsExport);

  const tracePayload = needsTracePayload
    ? await timer.measure(
        'build trace export',
        () =>
          buildDigestTraceableExportPayloadCached(
            scope,
            dateRange,
            data,
            clientAccountSummary ?? [],
            {
              includeTraceableExport,
              includeOpenCallsExport: includeOpenCallsExport && !options.forPreview,
              requireFullCorpus: needsFullTraceCorpus,
              skipRepairDone,
            }
          ),
        (payload) => `traceRows=${payload.traceRows.length}`
      )
    : undefined;

  if (tracePayload && !options.forPreview) {
    const reconciliation = reconcileMisEmailOpenCounts(tracePayload.grand, tracePayload.traceRows);
    console.log(
      `[mis-email/trace] open reconcile summary=${reconciliation.summaryOpen} trace=${reconciliation.traceOpenIncluded} delta=${reconciliation.delta} match=${reconciliation.matches}`
    );
  }

  let emailAttachments: EmailAttachment[];
  let attachmentFilenames: string[];

  if (options.forPreview) {
    attachmentFilenames = resolveDigestAttachmentFilenames(attachmentIncludes);
    emailAttachments = [];
    timer.step('preview filenames only', `${attachmentFilenames.length} files`);
  } else {
    emailAttachments = await timer.measure('build attachments', () =>
      buildDigestAttachments(effectiveRecipient, data, {
        registerRows,
        dateRange,
        clientAccountSummary: clientAccountSummary ?? [],
        effectiveIncludes: attachmentIncludes,
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
      {
        fullTraceRows: includeTraceableExport ? tracePayload?.traceRows : undefined,
        openTraceRows: includeTraceableExport
          ? undefined
          : tracePayload?.traceRows,
      }
    ), (ctx) => `accountRows=${ctx.accountRows?.length ?? 0}`
  );

  const bodyLayout = resolveMisEmailBodyLayoutFromPrefs(prefs);
  const org = await getMisEmailOrgSettings({ fresh: true });
  const portalUrl = resolvePortalUrl(org.portalBaseUrl);
  const subjectTemplate = resolveMisEmailSubjectTemplate(options.introPreset, {
    normal: org.subjectTemplate,
    revised: org.subjectTemplateRevised,
  });
  const branding = {
    greeting: org.greeting,
    brandTitle: org.brandTitle,
    brandSubtitle: resolveMisEmailBrandSubtitle(org.brandSubtitle, options.introPreset),
    subjectTemplate,
    introText: resolveMisEmailIntroText(options.introPreset, {
      normal: org.introTextNormal,
      revised: org.introTextRevised,
    }),
    introPreset: options.introPreset === 'revised' ? ('revised' as const) : ('normal' as const),
  };
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
    branding,
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
      subject: formatDigestSubject(dateRange.endDate, undefined, subjectTemplate),
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
    introPreset?: MisEmailIntroPreset;
  }
): Promise<MisEmailComposePreview> {
  const sentTo = recipient.email.trim().toLowerCase();
  const { preview } = await buildMisEmailPayload(recipient, {
    preferences: options.preferences,
    sentTo,
    displayName: options.displayName?.trim() || recipient.name,
    forPreview: true,
    introPreset: options.introPreset,
  });
  return preview;
}

export async function sendMisEmailCompose(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    sentTo: string;
    displayName?: string;
    introPreset?: MisEmailIntroPreset;
  }
): Promise<MisEmailSendResult> {
  const sentTo = options.sentTo.trim().toLowerCase();
  const displayName = options.displayName?.trim() || recipient.name;
  const { preview, emailAttachments, dateRange, scopeLabel, bodyHtml, bodyPlainText } =
    await buildMisEmailPayload(recipient, {
      preferences: options.preferences,
      sentTo,
      displayName,
      introPreset: options.introPreset,
    });

  const org = await getMisEmailOrgSettings({ fresh: true });
  const portalUrl = resolvePortalUrl(org.portalBaseUrl);
  const branding = {
    greeting: org.greeting,
    brandTitle: org.brandTitle,
    brandSubtitle: resolveMisEmailBrandSubtitle(org.brandSubtitle, options.introPreset),
    subjectTemplate: resolveMisEmailSubjectTemplate(options.introPreset, {
      normal: org.subjectTemplate,
      revised: org.subjectTemplateRevised,
    }),
    introText: resolveMisEmailIntroText(options.introPreset, {
      normal: org.introTextNormal,
      revised: org.introTextRevised,
    }),
    introPreset: options.introPreset === 'revised' ? ('revised' as const) : ('normal' as const),
  };
  const emailBody = {
    recipientName: displayName,
    recipientEmail: sentTo,
    dateRange,
    scopeLabel,
    portalUrl,
    bodyHtml,
    bodyPlainText,
    branding,
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
    displayName?: string;
    introPreset?: MisEmailIntroPreset;
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
  if (!routing.autoSendEnabled && !options.sendTo?.length) {
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
    introPreset: options.introPreset,
    timer: batchTimer,
  });

  const org = await getMisEmailOrgSettings({ fresh: true });
  const portalUrl = resolvePortalUrl(org.portalBaseUrl);
  const branding = {
    greeting: org.greeting,
    brandTitle: org.brandTitle,
    brandSubtitle: resolveMisEmailBrandSubtitle(org.brandSubtitle, options.introPreset),
    subjectTemplate: resolveMisEmailSubjectTemplate(options.introPreset, {
      normal: org.subjectTemplate,
      revised: org.subjectTemplateRevised,
    }),
    introText: resolveMisEmailIntroText(options.introPreset, {
      normal: org.introTextNormal,
      revised: org.introTextRevised,
    }),
    introPreset: options.introPreset === 'revised' ? ('revised' as const) : ('normal' as const),
  };
  const emailBody = {
    recipientName: options.displayName?.trim() || recipient.name,
    recipientEmail: primaryTarget,
    dateRange,
    scopeLabel,
    portalUrl,
    bodyHtml,
    bodyPlainText,
    branding,
  };

  const sentToLabel = targets.join(', ');
  const headerTo = targets.length === 1 ? targets[0] : targets;
  const headerCc = ccTargets.length ? ccTargets : undefined;
  const html = buildDigestEmailHtml(emailBody);
  const text = buildDigestEmailPlainText(emailBody);
  const { messageId } = await batchTimer.measure(
    `smtp send → to ${sentToLabel}${headerCc ? ` · cc ${ccTargets.join(', ')}` : ''}`,
    () =>
      sendPreparedDigestEmail({
        to: headerTo,
        cc: headerCc,
        subject: preview.subject,
        html,
        text,
        attachments: emailAttachments,
      })
  );

  const results: MisEmailSendResult[] = [
    {
      sentTo: sentToLabel,
      attachments: preview.attachments,
      scopeLabel,
      messageId: messageId ?? '',
      dateRange,
      timing: buildTiming,
    },
  ];

  const batchTiming = batchTimer.finish(
    `recipients=${targets.length} to · ${ccTargets.length} cc · messages=1`
  );
  results[0].timing = batchTiming;

  return results;
}
