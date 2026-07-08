import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';

/** Light theme — matches [data-theme="white"] in globals.css */
export const MIS_EMAIL_THEME = {
  bgSoft: '#f1f5f9',
  bgCanvas: '#ffffff',
  bgMuted: '#f8fafc',
  fgPrimary: '#0f172a',
  fgMuted: '#64748b',
  border: '#e2e8f0',
  accent: '#0f172a',
  link: '#1d4ed8',
  fontInline: "Arial, 'Segoe UI', sans-serif",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function stripLeadingRepeatedChars(value: string): string {
  return value.replace(/^(.)\1{3,}/i, '');
}

function looksLikeGibberishName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (trimmed.length > 40) return true;

  const core = stripLeadingRepeatedChars(trimmed);
  if (!core || core.length < 2) return true;
  if (/(.)\1{4,}/.test(core)) return true;
  if (/^(asdf|qwer|zxcv|hjkl|sdfg|dfgh|fghj|ghjk)/i.test(core)) return true;
  if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(core)) return true;
  if (/\d/.test(core) && !/\s/.test(core)) return true;
  if (core.length > 18 && !/\s/.test(core)) return true;

  const letters = core.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 2) return true;

  const vowels = letters.replace(/[^aeiouAEIOU]/g, '').length;
  const vowelRatio = vowels / letters.length;
  if (letters.length >= 6 && vowelRatio < 0.2) return true;

  return false;
}

function nameFromEmailLocal(email?: string): string | null {
  const local = email?.split('@')[0]?.trim();
  if (!local || looksLikeGibberishName(local)) return null;

  const token = local.split(/[._-]/).find((part) => part.length >= 2 && !looksLikeGibberishName(part));
  if (!token) return null;

  return titleCaseWord(token);
}

function resolveDisplayName(name: string, email?: string): string {
  const trimmed = name.trim();
  const emailLocal = email?.split('@')[0]?.trim().toLowerCase();

  if (emailLocal && trimmed.toLowerCase().replace(/[._-]/g, '') === emailLocal.replace(/[._-]/g, '')) {
    const fromEmail = nameFromEmailLocal(email);
    if (fromEmail) return fromEmail;
  }

  const core = stripLeadingRepeatedChars(trimmed);
  if (core && !looksLikeGibberishName(core)) {
    const first = core.split(/\s+/)[0] ?? core;
    return titleCaseWord(first);
  }

  const fromEmail = nameFromEmailLocal(email);
  if (fromEmail) return fromEmail;

  return 'Colleague';
}

/** e.g. "Dear Vishnu," */
export function formatRecipientGreeting(name: string, email?: string): string {
  return `Dear ${resolveDisplayName(name, email)},`;
}

/** e.g. "July 2026" from date range end date */
export function formatReportPeriod(dateRange: DigestDateRange): string {
  const end = dateRange.endDate?.trim();
  if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const [year, month] = end.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  return dateRange.label?.trim() || 'this period';
}

function buildCtaLink(href: string, label: string): string {
  const t = MIS_EMAIL_THEME;
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);

  return `<a class="email-link" href="${safeHref}" target="_blank" rel="noopener noreferrer"
    style="font-family:${t.fontInline};font-size:14px;font-weight:bold;line-height:1.5;color:${t.link};text-decoration:underline;">${safeLabel}</a>`;
}

function buildMetaCell(label: string, value: string): string {
  const t = MIS_EMAIL_THEME;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td class="email-meta-label" style="padding:0 0 4px;font-family:${t.fontInline};font-size:11px;line-height:1.4;color:${t.fgMuted};">${escapeHtml(label)}</td>
  </tr>
  <tr>
    <td class="email-meta-value" style="padding:0;font-family:${t.fontInline};font-size:14px;font-weight:bold;line-height:1.45;color:${t.fgPrimary};">${escapeHtml(value)}</td>
  </tr>
</table>`;
}

function buildMisTableDarkModeStyles(prefix = ''): string {
  const p = prefix ? `${prefix} ` : '';
  return `
    ${p}.mis-td, ${p}.mis-td-l { color: #e2e8f0 !important; }
    ${p}.mis-th { background-color: #0070C0 !important; color: #ffffff !important; border-color: #334155 !important; }
    ${p}.mis-td, ${p}.mis-th { border-color: #334155 !important; }
    ${p}.mis-td.mis-zone-north { background-color: #223428 !important; color: #d9f99d !important; }
    ${p}.mis-td.mis-zone-east { background-color: #1e3143 !important; color: #bfdbfe !important; }
    ${p}.mis-td.mis-zone-west { background-color: #3a2b1e !important; color: #fed7aa !important; }
    ${p}.mis-td.mis-zone-south { background-color: #2b313a !important; color: #e2e8f0 !important; }
    ${p}.mis-td.mis-zone-grand { background-color: #3f3b1d !important; color: #fde68a !important; }
    ${p}.mis-td.mis-zone-default { background-color: #1f2937 !important; color: #cbd5e1 !important; }
    ${p}.mis-solved { color: #34d399 !important; }
    ${p}.mis-cancel { color: #f87171 !important; }
    ${p}.mis-pct { color: #60a5fa !important; }
    ${p}.mis-open { color: #f1f5f9 !important; font-weight: bold !important; }
    ${p}.mis-note { background-color: #1e293b !important; color: #94a3b8 !important; border-color: #334155 !important; }
    ${p}.mis-title { color: #f1f5f9 !important; }`;
}

function buildMisZoneStyles(prefix = ''): string {
  const p = prefix ? `${prefix} ` : '';
  return `
    ${p}.mis-td.mis-zone-north { background-color: #e7f3de !important; }
    ${p}.mis-td.mis-zone-east { background-color: #deecf8 !important; }
    ${p}.mis-td.mis-zone-west { background-color: #fbe8d9 !important; }
    ${p}.mis-td.mis-zone-south { background-color: #eceef0 !important; }
    ${p}.mis-td.mis-zone-grand { background-color: #fff8bf !important; }
    ${p}.mis-td.mis-zone-default { background-color: #f1f5f9 !important; }`;
}

function buildForceLightStyles(params?: { includeDarkModeOverrides?: boolean }): string {
  const t = MIS_EMAIL_THEME;
  const includeDarkModeOverrides = params?.includeDarkModeOverrides !== false;

  const ogBlock = (prefix: string) => {
    const p = prefix ? `${prefix} ` : '';
    return `
    ${p}.email-body { background-color: ${t.bgSoft} !important; color: ${t.fgPrimary} !important; }
    ${p}.email-outer { background-color: ${t.bgSoft} !important; }
    ${p}.email-card { background-color: ${t.bgCanvas} !important; border-color: ${t.border} !important; }
    ${p}.email-panel, ${p}.email-content { background-color: ${t.bgCanvas} !important; }
    ${p}.email-stripe { background-color: ${t.accent} !important; }
    ${p}.email-meta { background-color: ${t.bgMuted} !important; border-color: ${t.border} !important; }
    ${p}.email-footer { background-color: ${t.bgMuted} !important; border-color: ${t.border} !important; }
    ${p}.email-brand, ${p}.email-title, ${p}.email-text, ${p}.email-strong, ${p}.email-meta-value { color: ${t.fgPrimary} !important; }
    ${p}.email-muted, ${p}.email-meta-label { color: ${t.fgMuted} !important; }
    ${p}.email-link { color: ${t.link} !important; }`;
  };

  return `
    :root { color-scheme: light only; supported-color-schemes: light; }
    body { margin: 0; padding: 0; width: 100%; -webkit-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    ${ogBlock('[data-ogsc]')}
    ${ogBlock('[data-ogsb]')}
    .mis-wrap { margin: 0 0 20px; border-collapse: collapse; width: 100%; table-layout: auto; background-color: ${t.bgCanvas} !important; }
    .mis-title { padding: 0 0 8px; font-size: 12px; font-weight: bold; line-height: 1.4; }
    .mis-inner { border-collapse: collapse; width: 100%; table-layout: auto; background-color: ${t.bgCanvas} !important; }
    .mis-th { padding: 6px 8px; font-size: 10px; font-weight: bold; line-height: 1.3; color: #ffffff; background-color: #0070C0; border: 1px solid ${t.border}; text-align: center; }
    .mis-th-l { text-align: left; }
    .mis-td { padding: 6px 8px; font-size: 10px; line-height: 1.35; color: ${t.fgPrimary}; border: 1px solid ${t.border}; text-align: center; }
    .mis-td-l { text-align: left; font-weight: bold; }
    .mis-solved { color: #059669; }
    .mis-cancel { color: #DC2626; }
    .mis-open { font-weight: bold; }
    .mis-pct { color: #1d4ed8; font-weight: bold; }
    .mis-note { padding: 8px; font-size: 10px; line-height: 1.4; color: ${t.fgMuted}; text-align: center; border: 1px solid ${t.border}; background-color: ${t.bgMuted}; }
    .mis-row td { background-color: transparent !important; }
    ${buildMisZoneStyles()}
    .mis-grid-cell .mis-wrap { margin: 0 0 12px; }
    .mis-grid-cell .mis-th, .mis-grid-cell .mis-td { font-size: 9px; padding: 4px 5px; }
    ${
      includeDarkModeOverrides
        ? `@media (prefers-color-scheme: dark) {
      ${buildMisTableDarkModeStyles()}
    }`
        : ''
    }
    ${buildMisZoneStyles('[data-ogsc]')}
    ${buildMisZoneStyles('[data-ogsb]')}
  `;
}

export function buildDigestEmailPlainText(params: {
  recipientName: string;
  recipientEmail?: string;
  dateRange: DigestDateRange;
  scopeLabel: string;
  portalUrl: string;
  bodyPlainText?: string;
}): string {
  const reportUrl = `${params.portalUrl.replace(/\/$/, '')}/report`;
  const greeting = formatRecipientGreeting(params.recipientName, params.recipientEmail);
  const period = formatReportPeriod(params.dateRange);
  const bodyPreview = params.bodyPlainText?.trim();

  const lines = [
    'WRL Dashboard — Western Refrigeration Pvt. Ltd.',
    '',
    greeting,
    '',
    bodyPreview
      ? `Your MIS report for ${period} is below. Full Excel reports are attached.`
      : `Your MIS report for ${period} is attached.`,
    `Report period: ${period}`,
    `Branch scope: ${params.scopeLabel}`,
  ];

  if (bodyPreview) {
    lines.push('', bodyPreview);
  }

  lines.push('', `Open dashboard: ${reportUrl}`, '', 'Automated MIS Digest');

  return lines.join('\n');
}

export function buildDigestEmailHtml(params: {
  recipientName: string;
  recipientEmail?: string;
  dateRange: DigestDateRange;
  scopeLabel: string;
  portalUrl: string;
  bodyHtml?: string;
}, options?: { forPreview?: boolean }): string {
  const t = MIS_EMAIL_THEME;
  const reportUrl = `${params.portalUrl.replace(/\/$/, '')}/report`;
  const greeting = formatRecipientGreeting(params.recipientName, params.recipientEmail);
  const period = formatReportPeriod(params.dateRange);
  const preheader = `MIS report for ${period} — ${params.scopeLabel}`;
  const cta = buildCtaLink(reportUrl, 'Open WRL Dashboard');
  const bodyHtml = params.bodyHtml?.trim() ?? '';
  const introText = bodyHtml
    ? `Your MIS report for <strong class="email-strong" style="font-weight:bold;color:${t.fgPrimary};">${escapeHtml(period)}</strong> is below. Full Excel reports are attached to this email.`
    : `Please find your MIS report for <strong class="email-strong" style="font-weight:bold;color:${t.fgPrimary};">${escapeHtml(period)}</strong> attached to this email.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>WRL MIS Reports</title>
  <style type="text/css">${buildForceLightStyles({ includeDarkModeOverrides: false })}</style>
</head>
<body class="email-body" bgcolor="${t.bgSoft}" style="margin:0;padding:0;width:100%;background-color:${t.bgSoft};font-family:${t.fontInline};color:${t.fgPrimary};font-size:14px;line-height:1.6;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>
  <table role="presentation" class="email-outer" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${t.bgSoft}" style="width:100%;background-color:${t.bgSoft};">
    <tr>
      <td align="left" bgcolor="${t.bgSoft}" style="padding:24px 20px;background-color:${t.bgSoft};">
        <table role="presentation" class="email-card" width="100%" cellspacing="0" cellpadding="0" border="1" bordercolor="${t.border}" bgcolor="${t.bgCanvas}" style="width:100%;max-width:100%;background-color:${t.bgCanvas};border:1px solid ${t.border};">
          <tr>
            <td class="email-stripe" bgcolor="${t.accent}" width="4" style="width:4px;background-color:${t.accent};font-size:0;line-height:0;">&nbsp;</td>
            <td class="email-content" bgcolor="${t.bgCanvas}" style="background-color:${t.bgCanvas};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="email-panel" bgcolor="${t.bgCanvas}" style="padding:32px 36px 24px;background-color:${t.bgCanvas};">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td class="email-brand" style="padding:0 0 4px;font-family:${t.fontInline};font-size:11px;font-weight:bold;line-height:1.4;letter-spacing:0.6px;color:${t.fgMuted};">WESTERN REFRIGERATION</td>
                      </tr>
                      <tr>
                        <td class="email-title" style="padding:0 0 24px;font-family:${t.fontInline};font-size:20px;font-weight:bold;line-height:1.25;color:${t.fgPrimary};">WRL Dashboard</td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 24px;border-top:1px solid ${t.border};font-size:0;line-height:0;height:1px;">&nbsp;</td>
                      </tr>
                      <tr>
                        <td class="email-text" style="padding:0 0 12px;font-family:${t.fontInline};font-size:14px;line-height:1.7;color:${t.fgPrimary};">${escapeHtml(greeting)}</td>
                      </tr>
                      <tr>
                        <td class="email-text" style="padding:0 0 28px;font-family:${t.fontInline};font-size:14px;line-height:1.7;color:${t.fgPrimary};">${introText}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ${
                  bodyHtml
                    ? `<tr>
                  <td class="email-panel" bgcolor="${t.bgCanvas}" style="padding:0 36px 24px;background-color:${t.bgCanvas};">
                    <!--[if mso]>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${t.bgCanvas}" style="background-color:${t.bgCanvas};">
                      <tr>
                        <td bgcolor="${t.bgCanvas}" style="background-color:${t.bgCanvas};">
                    <![endif]-->
                    <div style="overflow-x:auto;background-color:${t.bgCanvas};">${bodyHtml}</div>
                    <!--[if mso]>
                        </td>
                      </tr>
                    </table>
                    <![endif]-->
                  </td>
                </tr>`
                    : ''
                }
                <tr>
                  <td class="email-panel" bgcolor="${t.bgCanvas}" style="padding:0 36px 28px;background-color:${t.bgCanvas};">
                    <table role="presentation" class="email-meta" width="100%" cellspacing="0" cellpadding="0" border="1" bordercolor="${t.border}" bgcolor="${t.bgMuted}" style="background-color:${t.bgMuted};border:1px solid ${t.border};">
                      <tr>
                        <td width="50%" bgcolor="${t.bgMuted}" style="width:50%;padding:16px 18px;background-color:${t.bgMuted};border-right:1px solid ${t.border};">
                          ${buildMetaCell('Report period', period)}
                        </td>
                        <td width="50%" bgcolor="${t.bgMuted}" style="width:50%;padding:16px 18px;background-color:${t.bgMuted};">
                          ${buildMetaCell('Branch scope', params.scopeLabel)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="email-panel" bgcolor="${t.bgCanvas}" style="padding:0 36px 32px;background-color:${t.bgCanvas};">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td class="email-text" style="padding:0 0 6px;font-family:${t.fontInline};font-size:14px;line-height:1.7;color:${t.fgPrimary};">You can also review the latest figures online:</td>
                      </tr>
                      <tr>
                        <td style="padding:0;">${cta}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="email-footer" bgcolor="${t.bgMuted}" style="padding:16px 36px;background-color:${t.bgMuted};border-top:1px solid ${t.border};">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td class="email-muted" style="font-family:${t.fontInline};font-size:11px;line-height:1.6;color:${t.fgMuted};">Automated MIS Digest</td>
                      </tr>
                      <tr>
                        <td class="email-muted" style="padding:2px 0 0;font-family:${t.fontInline};font-size:11px;line-height:1.6;color:${t.fgMuted};">Western Refrigeration Pvt. Ltd.</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
