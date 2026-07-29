import type { EmailAttachment } from '@/features/mis-email/lib/build-attachments';
import {
  buildDigestEmailHtml,
  buildDigestEmailPlainText,
  formatDigestSubject,
  resolveMisEmailBrandSubtitle,
} from '@/features/mis-email/lib/email-template';
import type { DigestDateRange } from '@/features/mis-email/lib/fetch-digest-data';
import {
  assertOrgOutboundMailEnabled,
  getMisEmailOrgSettings,
} from '@/features/mis-email/lib/org-settings';
import {
  isMisEmailRelayConfigured,
  sendPreparedMisEmailViaVpsRelay,
} from '@/features/mis-email/lib/send-relay';
import { formatBytes } from '@/features/mis-email/lib/timing';

export {
  type SmtpConfig,
  isSmtpConfigured,
  resolveSmtpConfig,
  createMailTransport,
  resolvePortalUrl,
} from '@/lib/mail/smtp';
import {
  createMailTransport,
  resolvePortalUrl,
  resolveSmtpConfig,
} from '@/lib/mail/smtp';

function shouldSendViaPreparedRelay(): boolean {
  if (process.env.MIS_EMAIL_SEND_LOCAL_SMTP === 'true') return false;
  return isMisEmailRelayConfigured();
}

function formatMailAddresses(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function primaryMailAddress(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

/** Send a pre-built digest (HTML + attachments) via VPS relay or local SMTP. */
export async function sendPreparedDigestEmail(params: {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}): Promise<{ messageId: string }> {
  await assertOrgOutboundMailEnabled();
  const toLabel = formatMailAddresses(params.to);
  if (process.env.MIS_EMAIL_DRY_RUN === 'true') {
    console.log('[mis-email] DRY RUN — would send to', toLabel, {
      cc: params.cc ? formatMailAddresses(params.cc) : undefined,
      attachments: params.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`),
    });
    return { messageId: 'dry-run' };
  }

  if (shouldSendViaPreparedRelay()) {
    const started = Date.now();
    const attachmentBytes = params.attachments.reduce((sum, file) => sum + file.content.length, 0);
    console.log(
      `[mis-email/timing] smtp relay → ${toLabel}${params.cc ? ` · cc ${formatMailAddresses(params.cc)}` : ''} · attachments=${params.attachments.length} · payload ${formatBytes(attachmentBytes)} · html ${params.html.length} chars`
    );
    const result = await sendPreparedMisEmailViaVpsRelay({
      to: formatMailAddresses(params.to),
      cc: params.cc ? formatMailAddresses(params.cc) : undefined,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments.map((attachment) => ({
        filename: attachment.filename,
        contentBase64: attachment.content.toString('base64'),
        contentType: attachment.contentType,
      })),
    });
    console.log(`[mis-email/timing] smtp relay done: ${Date.now() - started}ms · messageId=${result.messageId}`);
    return result;
  }

  const started = Date.now();
  console.log(`[mis-email/timing] smtp direct → ${toLabel} · attachments=${params.attachments.length}`);
  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);

  const info = await transport.sendMail({
    from: smtp.from,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: params.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      contentDisposition: 'attachment' as const,
    })),
  });

  console.log(`[mis-email/timing] smtp direct done: ${Date.now() - started}ms · messageId=${info.messageId}`);
  return { messageId: String(info.messageId || '') };
}

/** Send digest with Excel attachments via configured SMTP (Gmail, or local VPS Postfix). */
export async function sendDigestEmail(params: {
  to: string | string[];
  cc?: string | string[];
  recipientName: string;
  recipientEmail?: string;
  dateRange: DigestDateRange;
  scopeLabel: string;
  attachments: EmailAttachment[];
  subjectDate?: Date;
  bodyHtml?: string;
  bodyPlainText?: string;
}): Promise<{ messageId: string }> {
  await assertOrgOutboundMailEnabled();
  if (process.env.MIS_EMAIL_DRY_RUN === 'true') {
    console.log('[mis-email] DRY RUN — would send to', formatMailAddresses(params.to), {
      cc: params.cc ? formatMailAddresses(params.cc) : undefined,
      attachments: params.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`),
      scope: params.scopeLabel,
    });
    return { messageId: 'dry-run' };
  }

  const org = await getMisEmailOrgSettings();
  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);

  const portalUrl = resolvePortalUrl(org.portalBaseUrl);
  const branding = {
    greeting: org.greeting,
    brandTitle: org.brandTitle,
    brandSubtitle: resolveMisEmailBrandSubtitle(org.brandSubtitle, 'normal'),
    subjectTemplate: org.subjectTemplate,
    introPreset: 'normal' as const,
  };

  const emailBody = {
    recipientName: params.recipientName,
    recipientEmail: params.recipientEmail ?? primaryMailAddress(params.to),
    dateRange: params.dateRange,
    scopeLabel: params.scopeLabel,
    portalUrl,
    bodyHtml: params.bodyHtml,
    bodyPlainText: params.bodyPlainText,
    branding,
  };

  const info = await transport.sendMail({
    from: smtp.from,
    to: params.to,
    cc: params.cc,
    subject: formatDigestSubject(
      params.dateRange.endDate,
      params.subjectDate,
      org.subjectTemplate,
      'normal'
    ),
    text: buildDigestEmailPlainText(emailBody),
    html: buildDigestEmailHtml(emailBody),
    attachments: params.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      contentDisposition: 'attachment' as const,
    })),
  });

  return { messageId: String(info.messageId || '') };
}
