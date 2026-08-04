import nodemailer from 'nodemailer';
import { resolvePortalUrlForResetEmail } from '@/lib/auth/portal-url-from-reset-link';
import { resolveSmtpConfig } from '@/lib/mail/smtp';

function createTransport() {
  const smtp = resolveSmtpConfig();
  const localTls = smtp.localRelay
    ? { ignoreTLS: true as const, tls: { rejectUnauthorized: false } }
    : { tls: { minVersion: 'TLSv1.2' as const } };

  if (smtp.user && smtp.pass) {
    return {
      smtp,
      transport: nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
        ...localTls,
      }),
    };
  }

  return {
    smtp,
    transport: nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...localTls,
    }),
  };
}

export async function sendPasswordResetEmail(params: {
  to: string;
  resetLink: string;
  recipientName?: string | null;
  portalUrl?: string | null;
}): Promise<{ messageId: string }> {
  const { smtp, transport } = createTransport();
  const portalUrl = resolvePortalUrlForResetEmail({
    resetLink: params.resetLink,
    portalUrl: params.portalUrl,
  });
  const greeting = params.recipientName?.trim() || params.to;

  const html = `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:.08em;color:#64748b">WESTERN REFRIGERATION</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">Reset your WRL Dashboard password</h1>
    <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.5">Hello ${greeting},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.5">Use the link below to choose a new password. This link can only be used once and expires after a short time.</p>
    <p style="margin:0 0 24px"><a href="${params.resetLink}" style="font-size:15px;font-weight:600;color:#0f172a">Reset password</a></p>
    <p style="margin:0;font-size:12px;color:#94a3b8">If you did not request this, you can ignore this email.<br>Portal: <a href="${portalUrl}">${portalUrl}</a></p>
  </div>
</body></html>`;

  const text = `Hello ${greeting},

Reset your WRL Dashboard password (one-time link):
${params.resetLink}

If you did not request this, ignore this email.
Portal: ${portalUrl}`;

  const info = await transport.sendMail({
    from: smtp.from,
    to: params.to,
    subject: 'WRL Dashboard — password reset',
    text,
    html,
  });

  return { messageId: String(info.messageId || '') };
}
