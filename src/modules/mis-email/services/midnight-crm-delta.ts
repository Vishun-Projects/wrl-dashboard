import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type ExcelJS from 'exceljs';
import {
  classifyRegisterRowStatus,
  type RegisterSummaryBucket,
} from '@/lib/call/status/register-row';
import { readCallsFromPostgres } from '@/lib/read-model/flags';
import { createMailTransport, resolveSmtpConfig } from '@/lib/mail/smtp';
import { SUMMARY_DEFAULT_CALL_TYPE } from '@/modules/mis';
import {
  buildRegisterExcelWorkbook,
  registerWorkbookToBuffer,
} from '@/modules/mis/register';
import { renderRegionalPerformanceTableHtml } from '@/modules/mis-email/services/body-sections';
import { fetchDigestClientAccountSummary } from '@/modules/mis-email/services/fetch-digest-accounts';
import {
  fetchDigestSummaryData,
  type DigestDateRange,
} from '@/modules/mis-email/services/fetch-digest-data';
import { buildMisEmailRegionalPerformanceRows } from '@/modules/mis-email/services/mail-basis';
import type { RegionalPerformanceRow } from '@/modules/mis-email/services/mail-types';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import { resolveDigestDateRangeForPreferences } from '@/modules/mis-email/services/preferences';
import { formatBytes } from '@/modules/mis-email/services/timing';
import type { UserDigestScope } from '@/modules/mis-email/services/user-scope';
import { queryDigestRegisterExportFromPostgres } from '@/sql/read-model/register';
import { REGISTER_BULK_MAX_ROWS } from '@/sql/read-model/register-columns';

export const MIDNIGHT_CRM_DELTA_DEFAULT_TO = 'vishunvishwakarma90211@gmail.com';
export const MIDNIGHT_CRM_EXCLUDED_ACCOUNTS = ['cadbury', 'mondelez', 'coke', 'hccb'] as const;
/** Midnight YTD export must not silently truncate (UI register cap is 100k). */
export const MIDNIGHT_CRM_EXPORT_MAX_ROWS = Math.max(500_000, REGISTER_BULK_MAX_ROWS * 5);

export type MidnightStatusCounts = {
  all: number;
  openUnallocated: number;
  assigned: number;
  open: number;
  closed: number;
  techSolved: number;
  solved: number;
  cancelled: number;
  transferred: number;
};

export type MidnightTotalsCompare = {
  previous: MidnightStatusCounts | null;
  /** Current report totals — YTD year-start → yesterday. */
  current: MidnightStatusCounts;
  change: MidnightStatusCounts | null;
};

export type MidnightCallDeltaRow = {
  key: string;
  trn: string;
  vcclid: string;
  customer: string;
  branch: string;
  region: string;
  account: string;
  loggedDate: string;
  oldStatus: string;
  newStatus: string;
  statusBucket: RegisterSummaryBucket;
};

export type MidnightCrmDeltaReport = {
  baseline: boolean;
  previousAsOfDate: string | null;
  asOfDate: string;
  compare: MidnightTotalsCompare;
  /** New calls since previous report, broken down by current status. */
  newIncreaseByStatus: Partial<Record<RegisterSummaryBucket, number>>;
  newlyClosed: MidnightCallDeltaRow[];
  newlyTechSolved: MidnightCallDeltaRow[];
  newlyCancelled: MidnightCallDeltaRow[];
  reopened: MidnightCallDeltaRow[];
  openToAssigned: MidnightCallDeltaRow[];
  newInSnapshot: MidnightCallDeltaRow[];
};

export type MidnightCrmDeltaSnapshot = {
  asOfDate: string;
  generatedAt: string;
  callType: string;
  counts: MidnightStatusCounts;
  calls: Record<string, RegisterSummaryBucket>;
  /** Morning-MIS regional rows (CRM − Cadbury + Mondelez + Coke). */
  regional?: RegionalPerformanceRow[];
};

const MIDNIGHT_MIS_SCOPE: UserDigestScope = {
  isHod: true,
  assignedOffices: [],
  scopeLabel: 'All',
};


const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const STATUS_LABEL: Record<RegisterSummaryBucket, string> = {
  openUnallocated: 'Open Unallocated',
  assigned: 'Assigned',
  techSolved: 'Tech. Solve Call',
  closed: 'Closed',
  cancelled: 'Cancelled',
  transferred: 'Transferred',
};

const TALLY_METRICS: { key: keyof MidnightStatusCounts; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open (total)' },
  { key: 'openUnallocated', label: 'Open Unallocated' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'closed', label: 'Closed' },
  { key: 'techSolved', label: 'Tech. Solve Call' },
  { key: 'solved', label: 'Solved (Closed + Tech)' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'transferred', label: 'Transferred' },
];

const EMPTY_COUNTS = (): MidnightStatusCounts => ({
  all: 0,
  openUnallocated: 0,
  assigned: 0,
  open: 0,
  closed: 0,
  techSolved: 0,
  solved: 0,
  cancelled: 0,
  transferred: 0,
});

export function midnightCrmDeltaSnapshotDir(root = process.cwd()): string {
  return join(root, 'logs', 'crm-delta-snapshots');
}

export function midnightCrmDeltaSnapshotPath(asOfDate: string, root = process.cwd()): string {
  return join(midnightCrmDeltaSnapshotDir(root), `${asOfDate}.json`);
}

/** Strict call key: vtrnno first, else ncode:nofficeid. */
export function midnightCrmCallKey(row: Record<string, unknown>): string {
  const trn = String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
  if (trn) return trn;
  const ncode = row.ncode ?? row.id;
  const office = row.nofficeid ?? row.officeId;
  return `${ncode}:${office}`;
}

export function midnightCrmLoggedDateIst(row: Record<string, unknown>): string {
  const raw = row.logged_at ?? row.callsdtrndate;
  if (raw == null || raw === '') return '';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

export function midnightCrmStatusLabel(bucket: RegisterSummaryBucket): string {
  return STATUS_LABEL[bucket];
}

export function midnightCrmCountFromBucket(
  counts: MidnightStatusCounts,
  bucket: RegisterSummaryBucket
): void {
  counts.all += 1;
  if (bucket === 'openUnallocated') {
    counts.openUnallocated += 1;
    counts.open += 1;
  } else if (bucket === 'assigned') {
    counts.assigned += 1;
    counts.open += 1;
  } else if (bucket === 'closed') {
    counts.closed += 1;
    counts.solved += 1;
  } else if (bucket === 'techSolved') {
    counts.techSolved += 1;
    counts.solved += 1;
  } else if (bucket === 'cancelled') {
    counts.cancelled += 1;
  } else if (bucket === 'transferred') {
    counts.transferred += 1;
  }
}

export function midnightCrmBuildYtdSummary(rows: Record<string, unknown>[]): MidnightStatusCounts {
  const counts = EMPTY_COUNTS();
  for (const row of rows) {
    midnightCrmCountFromBucket(counts, classifyRegisterRowStatus(row));
  }
  return counts;
}

export function midnightCrmSubtractCounts(
  current: MidnightStatusCounts,
  previous: MidnightStatusCounts
): MidnightStatusCounts {
  return {
    all: current.all - previous.all,
    openUnallocated: current.openUnallocated - previous.openUnallocated,
    assigned: current.assigned - previous.assigned,
    open: current.open - previous.open,
    closed: current.closed - previous.closed,
    techSolved: current.techSolved - previous.techSolved,
    solved: current.solved - previous.solved,
    cancelled: current.cancelled - previous.cancelled,
    transferred: current.transferred - previous.transferred,
  };
}

export function midnightCrmBuildTotalsCompare(
  previous: MidnightCrmDeltaSnapshot | null,
  current: MidnightStatusCounts
): MidnightTotalsCompare {
  if (!previous) {
    return { previous: null, current, change: null };
  }
  return {
    previous: previous.counts,
    current,
    change: midnightCrmSubtractCounts(current, previous.counts),
  };
}

export function midnightCrmSnapshotFromRows(
  rows: Record<string, unknown>[]
): Record<string, RegisterSummaryBucket> {
  const calls: Record<string, RegisterSummaryBucket> = {};
  for (const row of rows) {
    calls[midnightCrmCallKey(row)] = classifyRegisterRowStatus(row);
  }
  return calls;
}

export function midnightCrmBuildNewIncreaseByStatus(
  newInSnapshot: MidnightCallDeltaRow[]
): Partial<Record<RegisterSummaryBucket, number>> {
  const out: Partial<Record<RegisterSummaryBucket, number>> = {};
  for (const row of newInSnapshot) {
    out[row.statusBucket] = (out[row.statusBucket] ?? 0) + 1;
  }
  return out;
}

function deltaRowFromRegister(
  row: Record<string, unknown>,
  oldStatus: RegisterSummaryBucket | null,
  newStatus: RegisterSummaryBucket
): MidnightCallDeltaRow {
  return {
    key: midnightCrmCallKey(row),
    trn: String(row.vtrnno ?? row.UniqueCallNo ?? '—'),
    vcclid: String(row.vcclid ?? '—'),
    customer: String(row.PartyName ?? row.party_name ?? '—'),
    branch: String(row.officename ?? row.branch_name ?? '—'),
    region: String(row.region ?? '—'),
    account: String(row.account ?? '—'),
    loggedDate: midnightCrmLoggedDateIst(row) || '—',
    oldStatus: oldStatus ? midnightCrmStatusLabel(oldStatus) : '—',
    newStatus: midnightCrmStatusLabel(newStatus),
    statusBucket: newStatus,
  };
}

export function midnightCrmDiffSnapshots(params: {
  previous: MidnightCrmDeltaSnapshot | null;
  currentCalls: Record<string, RegisterSummaryBucket>;
  rowsByKey: Map<string, Record<string, unknown>>;
  asOfDate: string;
}): Omit<MidnightCrmDeltaReport, 'compare' | 'newIncreaseByStatus'> {
  const { previous, currentCalls, rowsByKey, asOfDate } = params;
  if (!previous) {
    return {
      baseline: true,
      previousAsOfDate: null,
      asOfDate,
      newlyClosed: [],
      newlyTechSolved: [],
      newlyCancelled: [],
      reopened: [],
      openToAssigned: [],
      newInSnapshot: [],
    };
  }

  const prevCalls = previous.calls;
  const report = {
    baseline: false,
    previousAsOfDate: previous.asOfDate,
    asOfDate,
    newlyClosed: [] as MidnightCallDeltaRow[],
    newlyTechSolved: [] as MidnightCallDeltaRow[],
    newlyCancelled: [] as MidnightCallDeltaRow[],
    reopened: [] as MidnightCallDeltaRow[],
    openToAssigned: [] as MidnightCallDeltaRow[],
    newInSnapshot: [] as MidnightCallDeltaRow[],
  };

  const openBuckets = new Set<RegisterSummaryBucket>(['openUnallocated', 'assigned']);
  const solvedBuckets = new Set<RegisterSummaryBucket>(['closed', 'techSolved']);

  for (const [key, newBucket] of Object.entries(currentCalls)) {
    const row = rowsByKey.get(key);
    if (!row) continue;
    const oldBucket = prevCalls[key];
    if (oldBucket == null) {
      report.newInSnapshot.push(deltaRowFromRegister(row, null, newBucket));
      continue;
    }
    if (oldBucket === newBucket) continue;

    const delta = deltaRowFromRegister(row, oldBucket, newBucket);
    if (newBucket === 'closed' && oldBucket !== 'closed') {
      report.newlyClosed.push(delta);
    }
    if (newBucket === 'techSolved' && oldBucket !== 'techSolved') {
      report.newlyTechSolved.push(delta);
    }
    if (newBucket === 'cancelled' && oldBucket !== 'cancelled') {
      report.newlyCancelled.push(delta);
    }
    if (openBuckets.has(newBucket) && solvedBuckets.has(oldBucket)) {
      report.reopened.push(delta);
    }
    if (oldBucket === 'openUnallocated' && newBucket === 'assigned') {
      report.openToAssigned.push(delta);
    }
  }

  return report;
}

export function assertMidnightCrmTallyParity(params: {
  rows: Record<string, unknown>[];
  ytd: MidnightStatusCounts;
  emailCounts: MidnightStatusCounts;
}): void {
  const { rows, ytd, emailCounts } = params;
  if (rows.length !== ytd.all) {
    throw new Error(
      `Midnight CRM tally parity failed: rows.length (${rows.length}) !== ytd.all (${ytd.all})`
    );
  }
  for (const { key, label } of TALLY_METRICS) {
    if (emailCounts[key] !== ytd[key]) {
      throw new Error(
        `Midnight CRM tally parity failed: email ${label} (${emailCounts[key]}) !== status_tally ${label} (${ytd[key]})`
      );
    }
  }
}

function formatCount(n: number): string {
  return n.toLocaleString('en-IN');
}

function formatSignedCount(n: number): string {
  if (n > 0) return `+${formatCount(n)}`;
  if (n < 0) return `−${formatCount(Math.abs(n))}`;
  return '0';
}

function sumMidnightRegionalAll(rows: RegionalPerformanceRow[]): RegionalPerformanceRow {
  return rows.reduce(
    (acc, row) => ({
      region: 'All',
      total_calls: acc.total_calls + row.total_calls,
      solved_calls: acc.solved_calls + row.solved_calls,
      cancelled_calls: acc.cancelled_calls + row.cancelled_calls,
      open_calls: acc.open_calls + row.open_calls,
      age_2: acc.age_2 + row.age_2,
      age_3: acc.age_3 + row.age_3,
      age_7: acc.age_7 + row.age_7,
      age_15: acc.age_15 + row.age_15,
      part_pending: acc.part_pending + row.part_pending,
      active_eng: acc.active_eng + row.active_eng,
    }),
    {
      region: 'All',
      total_calls: 0,
      solved_calls: 0,
      cancelled_calls: 0,
      open_calls: 0,
      age_2: 0,
      age_3: 0,
      age_7: 0,
      age_15: 0,
      part_pending: 0,
      active_eng: 0,
    }
  );
}

function regionalDisplayedTotal(row: RegionalPerformanceRow): number {
  return row.solved_calls + row.open_calls + row.cancelled_calls;
}

function regionalChangeNoteHtml(
  previous: RegionalPerformanceRow[] | null,
  current: RegionalPerformanceRow[],
  previousAsOfDate: string | null,
  asOfDate: string
): string {
  if (!previous?.length || !previousAsOfDate) return '';
  const prevAll = sumMidnightRegionalAll(previous);
  const curAll = sumMidnightRegionalAll(current);
  const dTotal = regionalDisplayedTotal(curAll) - regionalDisplayedTotal(prevAll);
  const dSolved = curAll.solved_calls - prevAll.solved_calls;
  const dCancelled = curAll.cancelled_calls - prevAll.cancelled_calls;
  const dOpen = curAll.open_calls - prevAll.open_calls;
  return (
    `<p style="margin:12px 0;color:#555;">` +
    `All-row change <strong>${previousAsOfDate}</strong> → <strong>${asOfDate}</strong>: ` +
    `Total ${formatSignedCount(dTotal)}, ` +
    `Solved ${formatSignedCount(dSolved)}, ` +
    `Cancelled ${formatSignedCount(dCancelled)}, ` +
    `Open ${formatSignedCount(dOpen)}.` +
    `</p>`
  );
}

function regionalPlainBlock(title: string, rows: RegionalPerformanceRow[]): string[] {
  const lines = [title, ''];
  const withAll = [...rows, sumMidnightRegionalAll(rows)];
  for (const row of withAll) {
    lines.push(
      `${row.region}: total ${formatCount(regionalDisplayedTotal(row))}, ` +
        `solved ${formatCount(row.solved_calls)}, cancelled ${formatCount(row.cancelled_calls)}, ` +
        `open ${formatCount(row.open_calls)}, <2d ${formatCount(row.age_2)}, ` +
        `>3d ${formatCount(row.age_3)}, >7d ${formatCount(row.age_7 + row.age_15)}, ` +
        `eng ${formatCount(row.active_eng)}`
    );
  }
  return lines;
}

/** Same MIS union regional table as morning digest (CRM − Cadbury + Mondelez + Coke). */
export async function fetchMidnightMisRegionalRows(
  dateRange: DigestDateRange
): Promise<RegionalPerformanceRow[]> {
  const [summary, clientAccounts] = await Promise.all([
    fetchDigestSummaryData(MIDNIGHT_MIS_SCOPE, dateRange),
    fetchDigestClientAccountSummary(dateRange),
  ]);
  return buildMisEmailRegionalPerformanceRows(summary, clientAccounts);
}

export function yearToEndDateRange(endDate: string): DigestDateRange {
  return {
    startDate: `${endDate.slice(0, 4)}-01-01`,
    endDate,
    label: `Year to ${endDate}`,
  };
}

export function buildMidnightCrmDeltaEmailHtml(params: {
  dateRange: DigestDateRange;
  callType: string;
  regional: RegionalPerformanceRow[];
  previousRegional: RegionalPerformanceRow[] | null;
  delta: MidnightCrmDeltaReport;
  generatedAtIst: string;
  exportRows: number;
}): string {
  const {
    dateRange,
    callType,
    regional,
    previousRegional,
    delta,
    generatedAtIst,
    exportRows,
  } = params;
  const baselineNote = delta.baseline
    ? `<p style="margin:0 0 12px;padding:10px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;">` +
      `First run — baseline snapshot saved. Previous-day regional table starts tomorrow.</p>`
    : `<p style="margin:0 0 12px;color:#555;">Previous report <strong>${delta.previousAsOfDate}</strong> → this report <strong>${delta.asOfDate}</strong> (same regional table as morning MIS mail).</p>`;

  const previousTable =
    previousRegional && previousRegional.length > 0 && delta.previousAsOfDate
      ? `<div style="margin:16px 0;">${renderRegionalPerformanceTableHtml(
          previousRegional,
          `Regional Performance — as of ${delta.previousAsOfDate}`
        )}</div>`
      : '';

  const currentTable = `<div style="margin:16px 0;">${renderRegionalPerformanceTableHtml(
    regional,
    `Regional Performance — as of ${delta.asOfDate}`
  )}</div>`;

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Arial,sans-serif;color:#222;line-height:1.5;max-width:960px;">
  <h2 style="margin:0 0 8px;">Midnight MIS Regional Report</h2>
  <p style="margin:0 0 12px;color:#555;">
    Overall period: <strong>${dateRange.startDate}</strong> → <strong>${dateRange.endDate}</strong> (year start through yesterday, IST)<br/>
    Call type: <strong>${callType}</strong><br/>
    Basis: same as morning MIS (CRM − Cadbury + Mondelez + Coke/HCCB)<br/>
    Generated: ${generatedAtIst} IST
  </p>
  ${baselineNote}
  ${previousTable}
  ${regionalChangeNoteHtml(previousRegional, regional, delta.previousAsOfDate, delta.asOfDate)}
  ${currentTable}
  <p style="margin:16px 0 0;color:#555;">Attached Excel: CRM register excl Cadbury/Mondelez/Coke/HCCB (${formatCount(exportRows)} rows) year start → ${dateRange.endDate}, plus status tally / change sheets.</p>
</body></html>`;
}

export function buildMidnightCrmDeltaEmailText(params: {
  dateRange: DigestDateRange;
  callType: string;
  regional: RegionalPerformanceRow[];
  previousRegional: RegionalPerformanceRow[] | null;
  delta: MidnightCrmDeltaReport;
  generatedAtIst: string;
  exportRows: number;
}): string {
  const {
    dateRange,
    callType,
    regional,
    previousRegional,
    delta,
    generatedAtIst,
    exportRows,
  } = params;
  const lines = [
    'Midnight MIS Regional Report',
    '',
    `Overall period: ${dateRange.startDate} → ${dateRange.endDate} (year start through yesterday, IST)`,
    `Call type: ${callType}`,
    'Basis: same as morning MIS (CRM − Cadbury + Mondelez + Coke/HCCB)',
    `Generated: ${generatedAtIst} IST`,
    '',
    delta.baseline
      ? 'First run — baseline snapshot saved. Previous-day regional table starts tomorrow.'
      : `Previous report ${delta.previousAsOfDate} → this report ${delta.asOfDate}`,
    '',
  ];

  if (previousRegional?.length && delta.previousAsOfDate) {
    lines.push(
      ...regionalPlainBlock(
        `Regional Performance — as of ${delta.previousAsOfDate}`,
        previousRegional
      ),
      ''
    );
    const prevAll = sumMidnightRegionalAll(previousRegional);
    const curAll = sumMidnightRegionalAll(regional);
    lines.push(
      `All-row change: Total ${formatSignedCount(regionalDisplayedTotal(curAll) - regionalDisplayedTotal(prevAll))}, ` +
        `Solved ${formatSignedCount(curAll.solved_calls - prevAll.solved_calls)}, ` +
        `Cancelled ${formatSignedCount(curAll.cancelled_calls - prevAll.cancelled_calls)}, ` +
        `Open ${formatSignedCount(curAll.open_calls - prevAll.open_calls)}`,
      ''
    );
  }

  lines.push(
    ...regionalPlainBlock(`Regional Performance — as of ${delta.asOfDate}`, regional),
    '',
    `Excel CRM excl rows: ${formatCount(exportRows)}`
  );

  return lines.join('\n');
}

function appendDeltaSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: MidnightCallDeltaRow[]
): void {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.columns = [
    { header: 'TRN', key: 'trn', width: 14 },
    { header: 'Call Centre ID', key: 'vcclid', width: 14 },
    { header: 'Customer', key: 'customer', width: 28 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Region', key: 'region', width: 14 },
    { header: 'Account', key: 'account', width: 18 },
    { header: 'Logged Date', key: 'loggedDate', width: 12 },
    { header: 'Previous Status', key: 'oldStatus', width: 18 },
    { header: 'Current Status', key: 'newStatus', width: 18 },
  ];
  for (const row of rows) {
    sheet.addRow(row);
  }
}

function appendStatusTallySheet(workbook: ExcelJS.Workbook, ytd: MidnightStatusCounts): void {
  const sheet = workbook.addWorksheet('status_tally');
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 24 },
    { header: 'Count', key: 'count', width: 12 },
  ];
  for (const { key, label } of TALLY_METRICS) {
    sheet.addRow({ metric: label, count: ytd[key] });
  }
}

function appendTotalsCompareSheet(
  workbook: ExcelJS.Workbook,
  compare: MidnightTotalsCompare,
  previousLabel: string
): void {
  const sheet = workbook.addWorksheet('totals_compare');
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 24 },
    { header: previousLabel, key: 'previous', width: 14 },
    { header: 'This report', key: 'current', width: 14 },
    { header: 'Change', key: 'change', width: 12 },
  ];
  for (const { key, label } of TALLY_METRICS) {
    sheet.addRow({
      metric: label,
      previous: compare.previous?.[key] ?? '',
      current: compare.current[key],
      change: compare.change?.[key] ?? '',
    });
  }
}

function appendNewCallsByStatusSheet(
  workbook: ExcelJS.Workbook,
  byStatus: Partial<Record<RegisterSummaryBucket, number>>
): void {
  const sheet = workbook.addWorksheet('new_calls_by_status');
  sheet.columns = [
    { header: 'Status', key: 'status', width: 22 },
    { header: 'New calls', key: 'count', width: 12 },
  ];
  for (const bucket of Object.keys(STATUS_LABEL) as RegisterSummaryBucket[]) {
    const count = byStatus[bucket] ?? 0;
    if (count > 0) {
      sheet.addRow({ status: midnightCrmStatusLabel(bucket), count });
    }
  }
}

function midnightDeltaFilename(endDate: string): string {
  return `WRL Midnight MIS Regional — ${endDate}.xlsx`;
}

function istNowLabel(): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());
}

function previousSnapshotDate(endDate: string): string {
  const [y, m, d] = endDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

async function resolveDigestCallType(): Promise<string> {
  try {
    const org = await getMisEmailOrgSettings();
    return org.digestCallType || SUMMARY_DEFAULT_CALL_TYPE;
  } catch {
    return SUMMARY_DEFAULT_CALL_TYPE;
  }
}

async function fetchMidnightCrmRows(
  dateRange: DigestDateRange,
  callType: string
): Promise<Record<string, unknown>[]> {
  if (!readCallsFromPostgres()) {
    throw new Error('Midnight CRM delta requires READ_CALLS_FROM=postgres');
  }

  const started = Date.now();
  const rows = await queryDigestRegisterExportFromPostgres(
    {
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
      excludeAccountsLower: [...MIDNIGHT_CRM_EXCLUDED_ACCOUNTS],
    },
    { maxRows: MIDNIGHT_CRM_EXPORT_MAX_ROWS }
  );
  console.log(
    `[midnight-crm-delta] register query ${dateRange.startDate}→${dateRange.endDate}: ${Date.now() - started}ms · rows=${rows.length}`
  );
  if (rows.length >= MIDNIGHT_CRM_EXPORT_MAX_ROWS) {
    throw new Error(
      `Midnight CRM export hit maxRows=${MIDNIGHT_CRM_EXPORT_MAX_ROWS} — totals would be truncated. Raise MIDNIGHT_CRM_EXPORT_MAX_ROWS.`
    );
  }
  return rows;
}

function loadPreviousSnapshot(asOfDate: string, root: string): MidnightCrmDeltaSnapshot | null {
  const path = midnightCrmDeltaSnapshotPath(asOfDate, root);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as MidnightCrmDeltaSnapshot;
  if (!raw.counts) {
    raw.counts = midnightCrmBuildYtdSummary(
      Object.entries(raw.calls).map(([key, bucket]) => ({
        vtrnno: key.includes(':') ? '' : key,
        ncode: key.includes(':') ? key.split(':')[0] : '',
        nofficeid: key.includes(':') ? key.split(':')[1] : '',
        bsolved: bucket === 'closed',
        bfastclose: bucket === 'techSolved',
        ncancelreason: bucket === 'cancelled' ? 5 : 0,
        nengineer: bucket === 'assigned' ? 1 : 0,
      }))
    );
  }
  return raw;
}

function saveSnapshot(snapshot: MidnightCrmDeltaSnapshot, root: string): void {
  const dir = midnightCrmDeltaSnapshotDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(midnightCrmDeltaSnapshotPath(snapshot.asOfDate, root), JSON.stringify(snapshot));
}

export async function runMidnightCrmDeltaReport(options?: {
  to?: string;
  dryRun?: boolean;
  rootDir?: string;
}): Promise<{
  messageId: string;
  dateRange: DigestDateRange;
  ytd: MidnightStatusCounts;
  delta: MidnightCrmDeltaReport;
  exportRows: number;
}> {
  const root = options?.rootDir ?? process.cwd();
  const dateRange = resolveDigestDateRangeForPreferences({ dateRange: 'year_to_yesterday' });
  const asOfDate = dateRange.endDate;
  const callType = await resolveDigestCallType();
  const to =
    options?.to?.trim().toLowerCase() ||
    process.env.MIDNIGHT_CRM_DELTA_TO?.trim().toLowerCase() ||
    process.env.NIGHTLY_YTD_EXPORT_TO?.trim().toLowerCase() ||
    MIDNIGHT_CRM_DELTA_DEFAULT_TO;

  console.log(
    `[midnight-crm-delta] start ${dateRange.startDate}→${dateRange.endDate} · callType=${callType} · to=${to}`
  );

  const [registerRows, regional] = await Promise.all([
    fetchMidnightCrmRows(dateRange, callType),
    fetchMidnightMisRegionalRows(dateRange),
  ]);

  if (registerRows.length === 0) {
    throw new Error(`No register rows found for ${dateRange.startDate}→${dateRange.endDate}`);
  }
  if (regional.length === 0) {
    throw new Error(`No MIS regional rows for ${dateRange.startDate}→${dateRange.endDate}`);
  }

  const ytd = midnightCrmBuildYtdSummary(registerRows);
  const currentCalls = midnightCrmSnapshotFromRows(registerRows);
  const rowsByKey = new Map(registerRows.map((row) => [midnightCrmCallKey(row), row]));

  const prevDate = previousSnapshotDate(asOfDate);
  const previous = loadPreviousSnapshot(prevDate, root);
  const compare = midnightCrmBuildTotalsCompare(previous, ytd);
  const diffCore = midnightCrmDiffSnapshots({
    previous,
    currentCalls,
    rowsByKey,
    asOfDate,
  });
  const newIncreaseByStatus = midnightCrmBuildNewIncreaseByStatus(diffCore.newInSnapshot);
  const delta: MidnightCrmDeltaReport = {
    ...diffCore,
    compare,
    newIncreaseByStatus,
  };

  let previousRegional: RegionalPerformanceRow[] | null = previous?.regional ?? null;
  if (!delta.baseline && (!previousRegional || previousRegional.length === 0)) {
    console.log(
      `[midnight-crm-delta] previous regional missing from snapshot — recomputing for ${prevDate}`
    );
    previousRegional = await fetchMidnightMisRegionalRows(yearToEndDateRange(prevDate));
  }

  assertMidnightCrmTallyParity({ rows: registerRows, ytd, emailCounts: ytd });

  const generatedAtIst = istNowLabel();
  const subject = `WRL Midnight MIS Regional — ${asOfDate}`;
  const html = buildMidnightCrmDeltaEmailHtml({
    dateRange,
    callType,
    regional,
    previousRegional,
    delta,
    generatedAtIst,
    exportRows: registerRows.length,
  });
  const text = buildMidnightCrmDeltaEmailText({
    dateRange,
    callType,
    regional,
    previousRegional,
    delta,
    generatedAtIst,
    exportRows: registerRows.length,
  });

  const workbookStarted = Date.now();
  const workbook = await buildRegisterExcelWorkbook(registerRows, {
    sheetName: 'raw_crm_excl',
  });
  appendStatusTallySheet(workbook, ytd);
  appendTotalsCompareSheet(workbook, compare, previous?.asOfDate ?? 'Previous');
  appendNewCallsByStatusSheet(workbook, newIncreaseByStatus);
  appendDeltaSheet(workbook, 'new_since_previous', delta.newInSnapshot);
  appendDeltaSheet(workbook, 'delta_closed', delta.newlyClosed);
  appendDeltaSheet(workbook, 'delta_tech_solved', delta.newlyTechSolved);
  appendDeltaSheet(workbook, 'delta_cancelled', delta.newlyCancelled);
  appendDeltaSheet(workbook, 'delta_reopened', delta.reopened);
  appendDeltaSheet(workbook, 'delta_open_assigned', delta.openToAssigned);
  const attachment = await registerWorkbookToBuffer(workbook);
  const filename = midnightDeltaFilename(asOfDate);
  console.log(
    `[midnight-crm-delta] workbook ${Date.now() - workbookStarted}ms · ${formatBytes(attachment.length)} · ${filename}`
  );

  const snapshot: MidnightCrmDeltaSnapshot = {
    asOfDate,
    generatedAt: new Date().toISOString(),
    callType,
    counts: ytd,
    calls: currentCalls,
    regional,
  };

  if (options?.dryRun || process.env.MIDNIGHT_CRM_DELTA_DRY_RUN === 'true') {
    console.log('[midnight-crm-delta] DRY RUN — would send', {
      to,
      subject,
      regionalAll: sumMidnightRegionalAll(regional),
      previousRegionalAll: previousRegional ? sumMidnightRegionalAll(previousRegional) : null,
      ytd,
      delta: {
        baseline: delta.baseline,
        totalIncrease: delta.compare.change?.all ?? 0,
        newCalls: delta.newInSnapshot.length,
        closed: delta.newlyClosed.length,
        tech: delta.newlyTechSolved.length,
        cancelled: delta.newlyCancelled.length,
      },
      attachment: `${filename} (${formatBytes(attachment.length)})`,
    });
    return { messageId: 'dry-run', dateRange, ytd, delta, exportRows: registerRows.length };
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
    `[midnight-crm-delta] mailed to ${to} in ${Date.now() - mailStarted}ms · messageId=${info.messageId ?? ''}`
  );

  saveSnapshot(snapshot, root);
  console.log(`[midnight-crm-delta] snapshot saved ${snapshot.asOfDate}`);

  return {
    messageId: String(info.messageId || ''),
    dateRange,
    ytd,
    delta,
    exportRows: registerRows.length,
  };
}
