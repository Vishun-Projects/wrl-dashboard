import type { SummaryDashboard } from '@/lib/summary/derive';
import { readCallsFromPostgres, readSummaryFromPostgres } from '@/lib/read-model/flags';
import { createMailTransport, resolveSmtpConfig } from '@/lib/mail/smtp';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/modules/mis';
import {
  buildRegisterExcelWorkbook,
  registerWorkbookToBuffer,
} from '@/modules/mis/register';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import {
  fetchDigestSummaryData,
  type DigestDateRange,
} from '@/modules/mis-email/services/fetch-digest-data';
import { resolveDigestDateRangeForPreferences } from '@/modules/mis-email/services/preferences';
import { formatBytes } from '@/modules/mis-email/services/timing';
import { queryDigestRegisterExportFromPostgres } from '@/sql/read-model/register';

export const NIGHTLY_YTD_EXPORT_DEFAULT_TO = 'vishunvishwakarma90211@gmail.com';

export type NightlyYtdExportSummary = {
  total: number;
  closed: number;
  open: number;
  cancelled: number;
  techSolved: number;
  exportRows: number;
};

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function aggregateYtdExportSummary(
  data: SummaryDashboard,
  exportRows: number
): NightlyYtdExportSummary {
  let total = 0;
  let closed = 0;
  let open = 0;
  let cancelled = 0;
  let techSolved = 0;

  for (const row of data.branchSummary) {
    total += Number(row.total_calls || 0);
    closed += Number(row.solved_calls || 0);
    open += Number(row.open_calls || 0);
    cancelled += Number(row.cancelled_calls || 0);
    techSolved += Number(row.tech_solved_calls || 0);
  }

  return { total, closed, open, cancelled, techSolved, exportRows };
}

function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

export function buildNightlyYtdExportEmailHtml(params: {
  dateRange: DigestDateRange;
  callType: string;
  summary: NightlyYtdExportSummary;
  generatedAtIst: string;
}): string {
  const { dateRange, callType, summary, generatedAtIst } = params;
  const row = (label: string, value: number) =>
    `<tr><td style="padding:8px 12px;border:1px solid #ddd;">${label}</td>` +
    `<td style="padding:8px 12px;border:1px solid #ddd;text-align:right;font-weight:600;">${formatCount(value)}</td></tr>`;

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#222;line-height:1.5;">
  <h2 style="margin:0 0 8px;">Nightly YTD Calls Export</h2>
  <p style="margin:0 0 16px;color:#555;">
    Period: <strong>${dateRange.startDate}</strong> to <strong>${dateRange.endDate}</strong>
    (${dateRange.label})<br/>
    Call type: <strong>${callType}</strong><br/>
    Generated: ${generatedAtIst} IST
  </p>
  <table style="border-collapse:collapse;min-width:320px;margin-bottom:16px;">
    <thead>
      <tr style="background:#0070C0;color:#fff;">
        <th style="padding:8px 12px;text-align:left;">Metric</th>
        <th style="padding:8px 12px;text-align:right;">Count</th>
      </tr>
    </thead>
    <tbody>
      ${row('Total calls (logged in range)', summary.total)}
      ${row('Closed / solved', summary.closed)}
      ${row('Open (unallocated + assigned)', summary.open)}
      ${row('Tech solved (in pipeline)', summary.techSolved)}
      ${row('Cancelled', summary.cancelled)}
      ${row('Rows in attached Excel', summary.exportRows)}
    </tbody>
  </table>
  <p style="margin:0;color:#555;">The attached workbook is the full call register export for the period above.</p>
</body></html>`;
}

export function buildNightlyYtdExportEmailText(params: {
  dateRange: DigestDateRange;
  callType: string;
  summary: NightlyYtdExportSummary;
  generatedAtIst: string;
}): string {
  const { dateRange, callType, summary, generatedAtIst } = params;
  return [
    'Nightly YTD Calls Export',
    '',
    `Period: ${dateRange.startDate} to ${dateRange.endDate} (${dateRange.label})`,
    `Call type: ${callType}`,
    `Generated: ${generatedAtIst} IST`,
    '',
    `Total calls (logged in range): ${formatCount(summary.total)}`,
    `Closed / solved: ${formatCount(summary.closed)}`,
    `Open (unallocated + assigned): ${formatCount(summary.open)}`,
    `Tech solved (in pipeline): ${formatCount(summary.techSolved)}`,
    `Cancelled: ${formatCount(summary.cancelled)}`,
    `Rows in attached Excel: ${formatCount(summary.exportRows)}`,
    '',
    'The attached workbook is the full call register export for the period above.',
  ].join('\n');
}

function ytdExportFilename(endDate: string): string {
  return `WRL YTD Calls Export — ${endDate}.xlsx`;
}

function istNowLabel(): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
}

async function resolveDigestCallType(): Promise<string> {
  try {
    const org = await getMisEmailOrgSettings();
    return org.digestCallType || SUMMARY_DEFAULT_CALL_TYPE;
  } catch {
    return SUMMARY_DEFAULT_CALL_TYPE;
  }
}

/** Fetch all register rows for YTD→yesterday (HOD / all branches). */
async function fetchYtdRegisterRows(
  dateRange: DigestDateRange,
  callType: string
): Promise<Record<string, unknown>[]> {
  if (!readCallsFromPostgres()) {
    throw new Error('Nightly YTD export requires READ_CALLS_FROM=postgres');
  }

  const started = Date.now();
  const rows = await queryDigestRegisterExportFromPostgres({
    page: 1,
    limit: 1,
    search: '',
    officeId: 'All',
    callType,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    status: '',
    account: '',
    region: '',
    pincode: '',
    priority: 'all',
    portalFilter: 'All',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    assignedOffices: [],
    visibleStatuses: [],
    isHod: true,
  });
  console.log(
    `[nightly-ytd-export] register query ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · rows=${rows.length}`
  );
  return rows;
}

export async function runNightlyYtdCallsExport(options?: {
  to?: string;
  dryRun?: boolean;
}): Promise<{ messageId: string; summary: NightlyYtdExportSummary; dateRange: DigestDateRange }> {
  if (!readSummaryFromPostgres()) {
    throw new Error(
      'Nightly YTD export requires READ_SUMMARY_FROM=postgres (or READ_CALLS_FROM=postgres)'
    );
  }

  const dateRange = resolveDigestDateRangeForPreferences({ dateRange: 'year_to_yesterday' });
  const callType = await resolveDigestCallType();
  const to =
    options?.to?.trim().toLowerCase() ||
    process.env.NIGHTLY_YTD_EXPORT_TO?.trim().toLowerCase() ||
    NIGHTLY_YTD_EXPORT_DEFAULT_TO;

  console.log(
    `[nightly-ytd-export] start ${dateRange.startDate}→${dateRange.endDate} · callType=${callType} · to=${to}`
  );

  const [summaryData, registerRows] = await Promise.all([
    fetchDigestSummaryData(
      { isHod: true, assignedOffices: [] },
      dateRange
    ),
    fetchYtdRegisterRows(dateRange, callType),
  ]);

  if (registerRows.length === 0) {
    throw new Error(`No register rows found for ${dateRange.startDate}→${dateRange.endDate}`);
  }

  const summary = aggregateYtdExportSummary(summaryData, registerRows.length);
  const generatedAtIst = istNowLabel();
  const subject = `WRL YTD Calls Export — ${dateRange.endDate}`;
  const html = buildNightlyYtdExportEmailHtml({ dateRange, callType, summary, generatedAtIst });
  const text = buildNightlyYtdExportEmailText({ dateRange, callType, summary, generatedAtIst });

  const workbookStarted = Date.now();
  const workbook = await buildRegisterExcelWorkbook(registerRows, {
    sheetName: 'YTD Calls',
  });
  const attachment = await registerWorkbookToBuffer(workbook);
  const filename = ytdExportFilename(dateRange.endDate);
  console.log(
    `[nightly-ytd-export] workbook ${Date.now() - workbookStarted}ms · ${formatBytes(attachment.length)} · ${filename}`
  );

  if (options?.dryRun || process.env.NIGHTLY_YTD_EXPORT_DRY_RUN === 'true') {
    console.log('[nightly-ytd-export] DRY RUN — would send', {
      to,
      subject,
      summary,
      attachment: `${filename} (${formatBytes(attachment.length)})`,
    });
    return { messageId: 'dry-run', summary, dateRange };
  }

  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const mailStarted = Date.now();
  const info = await transport.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
    html,
    attachments: [
      {
        filename,
        content: attachment,
        contentType: XLSX_CONTENT_TYPE,
        contentDisposition: 'attachment',
      },
    ],
  });
  console.log(
    `[nightly-ytd-export] mailed to ${to} in ${Date.now() - mailStarted}ms · messageId=${info.messageId ?? ''}`
  );

  return { messageId: String(info.messageId || ''), summary, dateRange };
}
