import { createMailTransport, isSmtpConfigured, resolveSmtpConfig } from '@/lib/mail/smtp';
import { resolveSuperAdminEmails } from '@/lib/security/superadmin-lookup';

export type SuspiciousActivityAlertInput = {
  ip: string | null;
  attemptedEmail?: string | null;
  route: string | null;
  userAgent: string | null;
  failedCount: number;
};

export async function sendSuspiciousActivityAlert(
  input: SuspiciousActivityAlertInput
): Promise<void> {
  const recipients = await resolveSuperAdminEmails();
  if (recipients.length === 0) {
    console.warn('[suspicious-alert] No superadmin email configured or found.');
    return;
  }

  const subject = `🚨 Security Alert: ${input.failedCount} Failed Sign-In Attempts Detected`;
  const time = new Date().toISOString();
  const text = `SECURITY SUSPICIOUS ACTIVITY ALERT

Multiple failed authentication attempts were detected on WRL Dashboard.

- IP Address: ${input.ip || 'Unknown'}
- Target Email: ${input.attemptedEmail || 'Not specified'}
- Failed Attempts: ${input.failedCount}
- Route: ${input.route || '/api/auth/sign-in'}
- Time (UTC): ${time}
- User Agent: ${input.userAgent || 'Unknown'}

Please review security audit logs immediately if this appears unauthorized.
`;

  const html = `
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; padding: 24px; border: 1px solid #fee2e2; border-radius: 12px; background: #fff5f5;">
  <h2 style="color: #991b1b; margin-top: 0; display: flex; align-items: center; gap: 8px;">
    🚨 Security Alert: Suspicious Sign-In Activity
  </h2>
  <p style="color: #7f1d1d; font-size: 15px;">Multiple consecutive failed authentication attempts were detected on WRL Dashboard.</p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 16px; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #fca5a5;">
    <tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 10px 14px; font-weight: 600; color: #450a0a; width: 140px;">IP Address</td><td style="padding: 10px 14px;"><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${input.ip || 'Unknown'}</code></td></tr>
    <tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 10px 14px; font-weight: 600; color: #450a0a;">Target Email</td><td style="padding: 10px 14px; color: #111827;">${input.attemptedEmail || 'Not specified'}</td></tr>
    <tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 10px 14px; font-weight: 600; color: #450a0a;">Failed Attempts</td><td style="padding: 10px 14px;"><span style="color: #dc2626; font-weight: 700;">${input.failedCount} attempts</span></td></tr>
    <tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 10px 14px; font-weight: 600; color: #450a0a;">Endpoint</td><td style="padding: 10px 14px; color: #374151;"><code>${input.route || '/api/auth/sign-in'}</code></td></tr>
    <tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 10px 14px; font-weight: 600; color: #450a0a;">Time (UTC)</td><td style="padding: 10px 14px; color: #374151;">${time}</td></tr>
    <tr><td style="padding: 10px 14px; font-weight: 600; color: #450a0a;">User Agent</td><td style="padding: 10px 14px; font-size: 12px; color: #4b5563;">${input.userAgent || 'Unknown'}</td></tr>
  </table>
  <p style="margin-top: 20px; font-size: 12px; color: #991b1b;">This security notification was generated automatically by WRL Dashboard Threat Prevention.</p>
</div>
`;

  if (isSmtpConfigured()) {
    try {
      const config = resolveSmtpConfig();
      const transporter = createMailTransport(config);
      await transporter.sendMail({
        from: config.from,
        to: recipients.join(', '),
        subject,
        text,
        html,
      });
      console.log(`[suspicious-alert] Alert email sent to superadmin (${recipients.join(', ')})`);
    } catch (err) {
      console.error('[suspicious-alert] Failed to send via SMTP:', err);
    }
  } else {
    console.warn(
      `[suspicious-alert] SMTP not configured. Alert logged for superadmin (${recipients.join(', ')}).`
    );
  }
}
