import nodemailer from 'nodemailer';
import type { EmailAttachment } from '@/lib/mis-email/build-attachments';
import { buildDigestEmailHtml, buildDigestEmailPlainText, formatDigestSubject } from '@/lib/mis-email/email-template';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import {
  isMisEmailRelayConfigured,
  sendPreparedMisEmailViaVpsRelay,
} from '@/lib/mis-email/send-relay';
import { formatBytes } from '@/lib/mis-email/timing';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  localRelay: boolean;
};

function isLocalSmtpHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost';
}

/** True when env has enough to send (local Postfix needs only host + from). */
export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (!host || !from) return false;
  if (isLocalSmtpHost(host)) return true;
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

export function resolveSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS?.trim() || '';
  const from = process.env.SMTP_FROM?.trim() || user;
  const localRelay = host ? isLocalSmtpHost(host) : false;

  if (!host || !from) {
    throw new Error(
      'Mail not configured — set SMTP_HOST and SMTP_FROM (Gmail: also SMTP_USER + SMTP_PASS app password)'
    );
  }

  if (!localRelay && (!user || !pass)) {
    throw new Error(
      'SMTP auth required — set SMTP_USER and SMTP_PASS (or use SMTP_HOST=127.0.0.1 with VPS Postfix)'
    );
  }

  if (localRelay && process.platform === 'win32') {
    throw new Error(
      'SMTP_HOST=127.0.0.1 only works on the VPS (Postfix). From your PC run: bash scripts/vps-hosting/run-mis-email-test-vps.sh'
    );
  }

  const port = Number(process.env.SMTP_PORT ?? (localRelay ? 25 : 587));
  const secure =
    process.env.SMTP_SECURE === 'true' ||
    (process.env.SMTP_SECURE !== 'false' && port === 465);

  return { host, port, secure, user, pass, from, localRelay };
}

export function createMailTransport(smtp: SmtpConfig) {
  const localTls = smtp.localRelay
    ? { ignoreTLS: true as const, tls: { rejectUnauthorized: false } }
    : { tls: { minVersion: 'TLSv1.2' as const } };

  if (smtp.user && smtp.pass) {
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      ...localTls,
    });
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...localTls,
  });
}

export function resolvePortalUrl(): string {
  const explicit = process.env.MIS_EMAIL_PORTAL_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return 'https://wrl-dashboard.vercel.app';
}

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
  if (process.env.MIS_EMAIL_DRY_RUN === 'true') {
    console.log('[mis-email] DRY RUN — would send to', formatMailAddresses(params.to), {
      cc: params.cc ? formatMailAddresses(params.cc) : undefined,
      attachments: params.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`),
      scope: params.scopeLabel,
    });
    return { messageId: 'dry-run' };
  }

  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);

  const portalUrl = resolvePortalUrl();

  const emailBody = {
    recipientName: params.recipientName,
    recipientEmail: params.recipientEmail ?? primaryMailAddress(params.to),
    dateRange: params.dateRange,
    scopeLabel: params.scopeLabel,
    portalUrl,
    bodyHtml: params.bodyHtml,
    bodyPlainText: params.bodyPlainText,
  };

  const info = await transport.sendMail({
    from: smtp.from,
    to: params.to,
    cc: params.cc,
    subject: formatDigestSubject(params.dateRange.endDate, params.subjectDate),
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
