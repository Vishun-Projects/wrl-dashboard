import nodemailer from 'nodemailer';

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
