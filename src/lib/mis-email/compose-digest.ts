import { buildDigestAttachments, type EmailAttachment } from '@/lib/mis-email/build-attachments';
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
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatReportPeriod,
} from '@/lib/mis-email/email-template';
import {
  hasAnyEffectiveDigestInclude,
  mergeMisEmailPreferences,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveExtraDigestEmails,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';
import type { DigestRecipient } from '@/lib/mis-email/recipients';
import { resolvePortalUrl, sendDigestEmail } from '@/lib/mis-email/send';
import { resolveUserDigestScopeWithLabel } from '@/lib/mis-email/user-scope';

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

async function buildMisEmailPayload(
  recipient: DigestRecipient,
  options: {
    preferences?: MisEmailPreferences;
    sentTo: string;
    displayName: string;
  }
): Promise<{
  preview: MisEmailComposePreview;
  emailAttachments: EmailAttachment[];
  dateRange: DigestDateRange;
  scopeLabel: string;
  bodyHtml?: string;
  bodyPlainText?: string;
}> {
  const effectiveRecipient = recipientWithPreferences(recipient, options.preferences);
  const prefs = effectiveRecipient.mis_email_preferences;
  const dateRange = resolveDigestDateRangeForPreferences(prefs);
  const effectiveIncludes = resolveEffectiveDigestIncludes(effectiveRecipient, prefs);

  if (!hasAnyEffectiveDigestInclude(effectiveIncludes)) {
    throw new Error('Select at least one report attachment');
  }

  const scope = await resolveUserDigestScopeWithLabel(effectiveRecipient);
  const data = await fetchDigestSummaryData(scope, dateRange);
  const registerRows = effectiveIncludes.includeDetailed
    ? await fetchDigestRegisterRows(effectiveRecipient, scope, dateRange)
    : undefined;
  const emailAttachments = await buildDigestAttachments(effectiveRecipient, data, {
    registerRows,
    effectiveIncludes,
  });

  if (emailAttachments.length === 0) {
    throw new Error('No attachments generated for your report permissions');
  }

  const bodySectionIds = resolveEffectiveBodySections(effectiveIncludes.includeSummary, prefs);
  const bodyHtml =
    bodySectionIds.length > 0 ? buildEmailBodySectionsHtml(bodySectionIds, data) : undefined;
  const bodyPlainText =
    bodySectionIds.length > 0 ? buildEmailBodySectionsPlainText(bodySectionIds, data) : undefined;

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

  return {
    preview: {
      subject: formatDigestSubject(),
      scopeLabel: scope.scopeLabel,
      dateRange,
      dateRangeLabel: formatReportPeriod(dateRange),
      attachments: emailAttachments.map((a) => a.filename),
      html: buildDigestEmailHtml(emailParams),
      plainText: buildDigestEmailPlainText(emailParams),
    },
    emailAttachments,
    dateRange,
    scopeLabel: scope.scopeLabel,
    bodyHtml,
    bodyPlainText,
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
  const { preview, emailAttachments, dateRange, scopeLabel, bodyHtml, bodyPlainText } =
    await buildMisEmailPayload(recipient, {
      preferences: options.preferences,
      sentTo,
      displayName: options.displayName?.trim() || recipient.name,
    });

  const { messageId } = await sendDigestEmail({
    to: sentTo,
    recipientName: options.displayName?.trim() || recipient.name,
    recipientEmail: sentTo,
    dateRange,
    scopeLabel,
    attachments: emailAttachments,
    bodyHtml,
    bodyPlainText,
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
  const prefs = mergeMisEmailPreferences(
    recipient.mis_email_preferences,
    options.preferences ?? {}
  );
  const targets = resolveMisEmailSendTargets(recipient, prefs, options.sendTo);
  if (targets.length === 0) {
    throw new Error('Add at least one recipient email');
  }

  const results: MisEmailSendResult[] = [];
  for (const sentTo of targets) {
    results.push(
      await sendMisEmailCompose(recipient, {
        preferences: options.preferences,
        sentTo,
        displayName: options.displayName,
      })
    );
  }
  return results;
}
