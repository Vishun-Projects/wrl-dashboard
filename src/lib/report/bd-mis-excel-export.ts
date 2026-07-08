import type ExcelJS from 'exceljs';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/report/summary-derive';
import {
  buildBdMisRegionalBreakdown,
  type BdMisGrandRow,
  type BdMisRegionalRow,
  type BdMisSourceFlags,
} from '@/lib/report/bd-mis-summary';
import { filterTraceRowsForExport, type BdMisTraceRow } from '@/lib/report/bd-mis-trace';
import {
  applySummaryHeaderStyle,
  applyRegionRowStyle,
} from '@/lib/report/summary-excel-export';

export type BdMisExportFilterMeta = {
  startDate: string;
  endDate: string;
  agingAsOf: string;
  callTypes: string;
  branches: string;
  franchisees: string;
  sources: BdMisSourceFlags;
};

export type BdMisExportPayload = {
  regionalRows: BdMisRegionalRow[];
  grand: BdMisGrandRow;
  crmBranchSummary: BranchSummaryRow[];
  crmAccountSummary: AccountSummaryRow[];
  clientAccountSummary: AccountSummaryRow[];
  sources: BdMisSourceFlags;
  filterMeta: BdMisExportFilterMeta;
};

export type BdMisTraceableExportPayload = BdMisExportPayload & {
  traceRows: BdMisTraceRow[];
  /** Summary dashboard uses date-filtered trace + UI regional totals; BD MIS uses snapshot client files. */
  traceAlign?: 'summary' | 'bd_mis';
};

function zoneShort(zone: string): string {
  return zone.replace(/\s+ZONE$/i, '').toUpperCase();
}

function metricOpen(m: {
  age_2?: number;
  age_3?: number;
  age_7?: number;
  age_15?: number;
}): number {
  return (
    Number(m.age_2 ?? 0) +
    Number(m.age_3 ?? 0) +
    Number(m.age_7 ?? 0) +
    Number(m.age_15 ?? 0)
  );
}

function addReconciliationMatrix(
  sheet: ExcelJS.Worksheet,
  breakdown: ReturnType<typeof buildBdMisRegionalBreakdown>
): void {
  const zones = breakdown.map((b) => zoneShort(b.region));
  const header = sheet.addRow(['Build step', ...zones, 'Notes']);
  applySummaryHeaderStyle(header);

  const steps: Array<{
    label: string;
    pick: (b: (typeof breakdown)[0]) => number;
    note: string;
    bold?: boolean;
  }> = [
    {
      label: '1. CRM branch rollup (plant-mapped, excl. cancelled)',
      pick: (b) => b.crmBranchBase.total_calls,
      note: 'Sum of CRM branches in zone',
    },
    {
      label: '2. − CRM Cadbury / Mondelez accounts',
      pick: (b) => -b.subtractCrmCadbury.total_calls,
      note: 'N/E/S only — replaced by Cadbury import',
    },
    {
      label: '3. + Client Cadbury (Mondelez file)',
      pick: (b) => b.addClientCadbury.total_calls,
      note: 'N/E/S only — not added in West',
    },
    {
      label: '4. − CRM Coke / HCCB accounts',
      pick: (b) => -b.subtractCrmCoke.total_calls,
      note: 'South only — replaced by Coke import',
    },
    {
      label: '5. + Client Coke (HCCB file → South)',
      pick: (b) => b.addClientCoke.total_calls,
      note: 'All Coke import rows roll to South',
    },
    {
      label: '= Dashboard total calls',
      pick: (b) => b.result.total_calls,
      note: 'Must match Summary sheet',
      bold: true,
    },
  ];

  for (const step of steps) {
    const row = sheet.addRow([step.label, ...breakdown.map((b) => step.pick(b)), step.note]);
    if (step.bold) {
      row.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      });
    }
  }

  sheet.addRow([]);
  const solvedHeader = sheet.addRow(['Solved — same steps', ...zones, '']);
  applySummaryHeaderStyle(solvedHeader);

  const solvedSteps = [
    { label: '1. CRM solved', pick: (b: (typeof breakdown)[0]) => b.crmBranchBase.total_solved },
    {
      label: '2. − CRM Cadbury solved',
      pick: (b: (typeof breakdown)[0]) => -b.subtractCrmCadbury.total_solved,
    },
    {
      label: '3. + Client Cadbury solved',
      pick: (b: (typeof breakdown)[0]) => b.addClientCadbury.total_solved,
    },
    {
      label: '4. − CRM Coke solved',
      pick: (b: (typeof breakdown)[0]) => -b.subtractCrmCoke.total_solved,
    },
    {
      label: '5. + Client Coke solved',
      pick: (b: (typeof breakdown)[0]) => b.addClientCoke.total_solved,
    },
    {
      label: '= Dashboard solved',
      pick: (b: (typeof breakdown)[0]) => b.result.total_solved,
      bold: true,
    },
  ];

  for (const step of solvedSteps) {
    const row = sheet.addRow([step.label, ...breakdown.map((b) => step.pick(b)), '']);
    if (step.bold) row.eachCell((cell) => { cell.font = { bold: true }; });
  }
}

function crmAccountRole(
  account: string,
  region: string,
  sources: BdMisSourceFlags
): string {
  const acc = account.trim().toLowerCase();
  const zone = region.toUpperCase();
  if (
    sources.crm &&
    sources.cadbury &&
    zone !== 'WEST ZONE' &&
    (acc === 'cadbury' || acc === 'mondelez')
  ) {
    return 'Subtracted — replaced by Cadbury import';
  }
  if (
    sources.crm &&
    sources.coke &&
    zone === 'SOUTH ZONE' &&
    (acc === 'coke' || acc === 'hccb')
  ) {
    return 'Subtracted — replaced by Coke import';
  }
  return 'Included in CRM branch base';
}

function clientAccountRole(account: string, region: string, sources: BdMisSourceFlags): string {
  const acc = account.trim().toLowerCase();
  const zone = region.toUpperCase();
  if (sources.cadbury && acc === 'cadbury' && zone !== 'WEST ZONE') {
    return 'Added — Mondelez file (Cadbury)';
  }
  if (sources.coke && acc === 'coke') {
    return 'Added to South — HCCB file (all Coke rows)';
  }
  return 'Not used in BD MIS formula';
}

export async function buildBdMisSummaryWorkbook(
  payload: BdMisExportPayload
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();
  const breakdown = buildBdMisRegionalBreakdown({
    crmBranchSummary: payload.crmBranchSummary,
    crmAccountSummary: payload.crmAccountSummary,
    clientAccountSummary: payload.clientAccountSummary,
    sources: payload.sources,
  });

  const meta = workbook.addWorksheet('About');
  meta.addRow(['Cadbury+Coke+CRM Summary — export audit']).font = { bold: true, size: 12 };
  meta.addRow([]);
  meta.addRow(['Date range', `${payload.filterMeta.startDate} to ${payload.filterMeta.endDate}`]);
  meta.addRow(['Aging as of', payload.filterMeta.agingAsOf]);
  meta.addRow(['Call types', payload.filterMeta.callTypes]);
  meta.addRow(['Branches', payload.filterMeta.branches]);
  meta.addRow(['Franchisees', payload.filterMeta.franchisees]);
  meta.addRow(['CRM source', payload.filterMeta.sources.crm ? 'On' : 'Off']);
  meta.addRow(['Cadbury source', payload.filterMeta.sources.cadbury ? 'On' : 'Off']);
  meta.addRow(['Coke source', payload.filterMeta.sources.coke ? 'On' : 'Off']);
  meta.addRow([]);
  meta.addRow(['Formula (matches BD_MIS Excel Main union):']);
  meta.addRow(['  CRM plant-mapped branches, excluding cancelled calls']);
  meta.addRow(['  − CRM Cadbury/Mondelez in North, East, South']);
  meta.addRow(['  + Client Cadbury (Mondelez) in North, East, South']);
  meta.addRow(['  − CRM Coke/HCCB in South only']);
  meta.addRow(['  + All Client Coke (HCCB) to South']);
  meta.addRow([]);
  meta.addRow(['Sheets:']);
  meta.addRow(['  How counts built — step matrix per region']);
  meta.addRow(['  Summary — dashboard regional table']);
  meta.addRow(['  CRM Branches — plant-mapped branch rollup']);
  meta.addRow(['  CRM Accounts — per account with subtract/include role']);
  meta.addRow(['  Client Import — Cadbury/Coke rows added to totals']);

  const recon = workbook.addWorksheet('How counts built');
  recon.addRow(['Regional total calls — how each zone is calculated']).font = { bold: true, size: 12 };
  recon.addRow([]);
  addReconciliationMatrix(recon, breakdown);

  const summary = workbook.addWorksheet('Summary');
  const sumHeader = summary.addRow([
    'Region',
    'Total calls',
    'Total solved',
    '# open calls',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
    '# active Eng.',
  ]);
  applySummaryHeaderStyle(sumHeader);

  for (const row of payload.regionalRows) {
    const r = summary.addRow([
      zoneShort(row.region),
      row.total_calls,
      row.total_solved,
      row.open_calls,
      row.age_2,
      row.age_3,
      row.age_7,
      row.age_15,
      row.active_eng,
    ]);
    applyRegionRowStyle(r, row.region);
  }

  const g = payload.grand;
  const totalRow = summary.addRow([
    'All',
    g.total_calls,
    g.total_solved,
    g.open_calls,
    g.age_2,
    g.age_3,
    g.age_7,
    g.age_15,
    g.active_eng,
  ]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  });

  const branches = workbook.addWorksheet('CRM Branches');
  const brHeader = branches.addRow([
    'Region',
    'Branch',
    'Office ID',
    'Total calls',
    'Solved',
    'Cancelled',
    'Open',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
    'Active Eng.',
  ]);
  applySummaryHeaderStyle(brHeader);

  const sortedBranches = [...payload.crmBranchSummary].sort(
    (a, b) =>
      String(a.region).localeCompare(String(b.region)) ||
      String(a.branch).localeCompare(String(b.branch))
  );
  for (const b of sortedBranches) {
    const r = branches.addRow([
      b.region,
      b.branch,
      b.officeId,
      b.total_calls,
      b.solved_calls,
      b.cancelled_calls,
      b.open_calls,
      b.age_2,
      b.age_3,
      b.age_7,
      b.age_15,
      b.active_eng,
    ]);
    applyRegionRowStyle(r, String(b.region));
  }

  const crmAcc = workbook.addWorksheet('CRM Accounts');
  const crmAccHeader = crmAcc.addRow([
    'Region',
    'Account',
    'Role in formula',
    'Total calls',
    'Solved',
    'Open (aging)',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
  ]);
  applySummaryHeaderStyle(crmAccHeader);

  const sortedCrmAccounts = [...payload.crmAccountSummary].sort(
    (a, b) =>
      String(a.region).localeCompare(String(b.region)) ||
      String(a.account).localeCompare(String(b.account))
  );
  for (const a of sortedCrmAccounts) {
    const open = metricOpen(a);
    const role = crmAccountRole(String(a.account ?? ''), String(a.region ?? ''), payload.sources);
    const r = crmAcc.addRow([
      a.region,
      a.account,
      role,
      a.total_calls,
      a.total_solved,
      open,
      a.age_2,
      a.age_3,
      a.age_7,
      a.age_15,
    ]);
    applyRegionRowStyle(r, String(a.region));
    if (role.startsWith('Subtracted')) {
      r.getCell(3).font = { color: { argb: 'FFDC2626' } };
    }
  }

  const client = workbook.addWorksheet('Client Import');
  const clientHeader = client.addRow([
    'Region',
    'Account',
    'Role in formula',
    'Total calls',
    'Solved',
    'Open (aging)',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
  ]);
  applySummaryHeaderStyle(clientHeader);

  const sortedClient = [...payload.clientAccountSummary].sort(
    (a, b) =>
      String(a.region).localeCompare(String(b.region)) ||
      String(a.account).localeCompare(String(b.account))
  );
  for (const a of sortedClient) {
    const open = metricOpen(a);
    const role = clientAccountRole(String(a.account ?? ''), String(a.region ?? ''), payload.sources);
    const r = client.addRow([
      a.region,
      a.account,
      role,
      a.total_calls,
      a.total_solved,
      open,
      a.age_2,
      a.age_3,
      a.age_7,
      a.age_15,
    ]);
    applyRegionRowStyle(r, String(a.region));
    if (role.startsWith('Added')) {
      r.getCell(3).font = { color: { argb: 'FF059669' } };
    }
  }

  for (const sheet of workbook.worksheets) {
    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = Math.min(len + 2, 48);
      });
      col.width = max;
    });
  }

  return workbook;
}

export function bdMisSummaryFilename(date = new Date()): string {
  return `WRL_BD_MIS_Summary_Audit_${date.toISOString().split('T')[0]}.xlsx`;
}

const TRACE_DETAIL_COLUMNS = [
  'Region',
  'Main Plant/Main Branch Name',
  'Branch/Franchisee name',
  'ASP / WRL Technician Name',
  'Customer Name',
  'Call Date & Time',
  'Service Order/ Call ID',
  'Client',
  'Call Status',
  'Aging',
  'File Name',
  'Contribution Step',
  'Included In Final Count',
  'Counts Toward',
] as const;

function addTraceSummarySheet(
  workbook: ExcelJS.Workbook,
  payload: BdMisTraceableExportPayload
): void {
  const summary = workbook.addWorksheet('Summary');
  const sumHeader = summary.addRow([
    'Region',
    'Total calls',
    'Total solved',
    '# open calls',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
    '# active Eng.',
  ]);
  applySummaryHeaderStyle(sumHeader);

  for (const row of payload.regionalRows) {
    const r = summary.addRow([
      zoneShort(row.region),
      row.total_calls,
      row.total_solved,
      row.open_calls,
      row.age_2,
      row.age_3,
      row.age_7,
      row.age_15,
      row.active_eng,
    ]);
    applyRegionRowStyle(r, row.region);
  }

  const g = payload.grand;
  const totalRow = summary.addRow([
    'All',
    g.total_calls,
    g.total_solved,
    g.open_calls,
    g.age_2,
    g.age_3,
    g.age_7,
    g.age_15,
    g.active_eng,
  ]);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  });
}

function addTraceCountSheet(
  workbook: ExcelJS.Workbook,
  payload: BdMisTraceableExportPayload
): void {
  const breakdown = buildBdMisRegionalBreakdown({
    crmBranchSummary: payload.crmBranchSummary,
    crmAccountSummary: payload.crmAccountSummary,
    clientAccountSummary: payload.clientAccountSummary,
    sources: payload.sources,
  });

  const recon = workbook.addWorksheet('Count Trace');
  recon.addRow(['Regional total calls — how each zone is calculated']).font = {
    bold: true,
    size: 12,
  };
  recon.addRow([]);
  addReconciliationMatrix(recon, breakdown);
}

function addTraceRowDetailSheet(
  workbook: ExcelJS.Workbook,
  traceRows: BdMisTraceRow[]
): void {
  const exportRows = filterTraceRowsForExport(traceRows);
  const EXCEL_MAX_DATA_ROWS = 1_048_575;
  const chunkCount = Math.max(1, Math.ceil(exportRows.length / EXCEL_MAX_DATA_ROWS));

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
    const start = chunkIndex * EXCEL_MAX_DATA_ROWS;
    const chunk = exportRows.slice(start, start + EXCEL_MAX_DATA_ROWS);
    const sheetLabel =
      chunkCount === 1 ? 'Row Detail' : `Row Detail ${chunkIndex + 1}`;
    const detail = workbook.addWorksheet(sheetLabel.slice(0, 31));

    const header = detail.addRow([...TRACE_DETAIL_COLUMNS]);
    applySummaryHeaderStyle(header);

    for (const row of chunk) {
      detail.addRow([
        row.region.replace(/\s+ZONE$/i, ''),
        row.plant,
        row.office_under_branch,
        row.technician_name,
        row.customer_name,
        row.call_date_time,
        row.service_order,
        row.client,
        row.call_status,
        row.aging,
        row.file_name,
        row.contribution_step,
        row.included_in_final_count ? 'Yes' : 'No',
        row.counts_toward,
      ]);
    }

    const lastRow = detail.rowCount;
    if (lastRow >= 2) {
      detail.autoFilter = 'A1:N1';
    }
  }
}

function autoSizeWorkbookColumns(
  workbook: ExcelJS.Workbook,
  opts?: { skipSheetNamePattern?: RegExp }
): void {
  for (const sheet of workbook.worksheets) {
    if (opts?.skipSheetNamePattern?.test(sheet.name)) {
      sheet.columns.forEach((col) => {
        col.width = 16;
      });
      continue;
    }
    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > max) max = Math.min(len + 2, 48);
      });
      col.width = max;
    });
  }
}

/** Traceable export: Summary dashboard + count reconciliation + full row detail. */
export async function buildBdMisTraceableWorkbook(
  payload: BdMisTraceableExportPayload
): Promise<ExcelJS.Workbook> {
  const ExcelJSRuntime = (await import('exceljs')).default;
  const workbook = new ExcelJSRuntime.Workbook();

  const meta = workbook.addWorksheet('About');
  meta.addRow(['Cadbury+Coke+CRM — traceable export']).font = { bold: true, size: 12 };
  meta.addRow([]);
  meta.addRow(['Date range', `${payload.filterMeta.startDate} to ${payload.filterMeta.endDate}`]);
  meta.addRow(['Aging as of', payload.filterMeta.agingAsOf]);
  meta.addRow(['Call types', payload.filterMeta.callTypes]);
  meta.addRow(['Branches', payload.filterMeta.branches]);
  meta.addRow(['Franchisees', payload.filterMeta.franchisees]);
  meta.addRow(['CRM source', payload.filterMeta.sources.crm ? 'On' : 'Off']);
  meta.addRow(['Cadbury source', payload.filterMeta.sources.cadbury ? 'On' : 'Off']);
  meta.addRow(['Coke source', payload.filterMeta.sources.coke ? 'On' : 'Off']);
  meta.addRow([]);
  meta.addRow(['Sheets:']);
  meta.addRow(['  Summary — dashboard regional table (snapshot at export)']);
  if (payload.traceAlign === 'bd_mis') {
    meta.addRow(['  Count Trace — step matrix per region (BD MIS union)']);
  } else {
    meta.addRow(['  Count Trace — omitted (Summary dashboard uses on-screen merge, not BD MIS union)']);
  }
  meta.addRow(['  Row Detail — call rows in the selected date range (same scope as the dashboard)']);
  meta.addRow([]);
  meta.addRow(['Row detail count', filterTraceRowsForExport(payload.traceRows).length]);
  meta.addRow(['Row detail scope', 'Non-cancelled calls in the selected date range']);
  meta.addRow([
    'Trace scope',
    payload.traceAlign === 'bd_mis'
      ? 'BD MIS audit (client Coke/Cadbury use latest full snapshot files)'
      : 'Summary dashboard (CRM + client rows filtered to the selected date range)',
  ]);

  addTraceRowDetailSheet(workbook, payload.traceRows);
  addTraceSummarySheet(workbook, payload);
  if (payload.traceAlign === 'bd_mis') {
    addTraceCountSheet(workbook, payload);
  }
  autoSizeWorkbookColumns(workbook, { skipSheetNamePattern: /^Row Detail/ });

  return workbook;
}

export function bdMisTraceableFilename(date = new Date()): string {
  return `WRL_BD_MIS_Traceable_${date.toISOString().split('T')[0]}.xlsx`;
}
