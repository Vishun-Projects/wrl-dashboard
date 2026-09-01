import { describe, expect, it } from 'vitest';
import { buildAccountDisplayRows } from '@/modules/mis/services/account-merge';
import {
  buildBdMisOpenCallsWorkbook,
  buildBdMisSummaryWorkbook,
  buildBdMisTraceableWorkbook,
} from '@/modules/mis/services/bd-mis-excel-export';
import {
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
  type BdMisSourceFlags,
} from '@/modules/mis/services/bd-mis-summary';
import {
  buildBdMisTraceRows,
  countTraceOpenCalls,
  filterTraceRowsForOpenExport,
  filterTraceRowsForSummaryExport,
} from '@/modules/mis/services/bd-mis-trace';
import {
  buildKeyAccountMisWorkbook,
  buildSummaryDashboardWorkbook,
} from '@/modules/mis/services/summary-excel-export';
import {
  buildSummaryDashboardExportAlign,
  sumUiRegionalRows,
} from '@/modules/mis/services/summary-trace-export';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/summary/derive';

const SOURCES: BdMisSourceFlags = {
  crm: true,
  cadbury: true,
  coke: true,
  excludeCrmCadbury: true,
};

function branchRow(
  officeId: number,
  zone: string,
  name: string,
  open: number,
  solved = 10
): BranchSummaryRow {
  const total = solved + open;
  return {
    officeId,
    parentId: 0,
    branch: name,
    region: zone,
    total_calls: total,
    solved_calls: solved,
    cancelled_calls: 0,
    open_calls: open,
    age_2: Math.min(open, 1),
    age_3: 0,
    age_7: 0,
    age_15: Math.max(0, open - 1),
    part_pending: 0,
    all_total: total,
    all_solved: solved,
    all_cancelled: 0,
    all_open: open,
    all_age_2: Math.min(open, 1),
    all_age_3: 0,
    all_age_7: 0,
    all_age_15: Math.max(0, open - 1),
    all_part_pending: 0,
    all_tech_solved: solved,
    tech_solved_calls: solved,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 1,
    population: total,
    headcount: 0,
  };
}

function accountRow(zone: string, name: string, open: number, solved = 5): AccountSummaryRow {
  const total = solved + open;
  return {
    region: zone,
    account: name,
    population: total,
    total_calls: total,
    total_solved: solved,
    cancelled_calls: 0,
    open_calls: open,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: open,
    part_pending: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 1,
    headcount: 0,
    total_tech_solved: solved,
  };
}

const filterMeta = {
  startDate: '2026-01-01',
  endDate: '2026-07-09',
  agingAsOf: '2026-07-09',
  callTypes: 'BREAKDOWN',
  branches: 'All Branches',
  franchisees: 'All Franchisees',
  sources: SOURCES,
};

function sharedCrmBranches(): BranchSummaryRow[] {
  return [
    branchRow(1, 'NORTH ZONE', '1101 - DELHI BRANCH', 4, 6),
    branchRow(2, 'EAST ZONE', '1154 - KOLKATA BRANCH', 3, 7),
    branchRow(3, 'WEST ZONE', '1120 - HUBLI BRANCH', 2, 8),
    branchRow(4, 'SOUTH ZONE', '1130 - CHENNAI BRANCH', 5, 5),
  ];
}

function sharedCrmAccounts(): AccountSummaryRow[] {
  return [
    accountRow('NORTH ZONE', 'Nestle', 2, 3),
    accountRow('NORTH ZONE', 'Cadbury', 1, 2),
    accountRow('EAST ZONE', 'Pepsi', 2, 2),
    accountRow('SOUTH ZONE', 'Coke', 3, 2),
  ];
}

function sharedClientAccounts(): AccountSummaryRow[] {
  return [
    accountRow('NORTH ZONE', 'Cadbury', 2, 1),
    accountRow('SOUTH ZONE', 'Coke', 1, 1),
  ];
}

function sharedTraceRows() {
  return buildBdMisTraceRows({
    crmRows: [
      {
        region: 'NORTH ZONE',
        plant: '1101 - DELHI BRANCH',
        technician_name: 'T1',
        office_under_branch: 'Delhi',
        customer_name: 'C1',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-N-OPEN',
        client: 'Nestle',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Nestle',
      },
      {
        region: 'EAST ZONE',
        plant: '1154 - KOLKATA BRANCH',
        technician_name: 'T2',
        office_under_branch: 'Kolkata',
        customer_name: 'C2',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-E-OPEN',
        client: 'Pepsi',
        call_status: 'Open',
        status_bucket: 'open_unallocated',
        ncancelreason: null,
        account: 'Pepsi',
      },
      {
        region: 'SOUTH ZONE',
        plant: '1130 - CHENNAI BRANCH',
        technician_name: 'T3',
        office_under_branch: 'Chennai',
        customer_name: 'C3',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-S-SOLVED',
        client: 'Nestle',
        call_status: 'Solved',
        status_bucket: 'solved',
        ncancelreason: null,
        account: 'Nestle',
      },
      {
        region: 'WEST ZONE',
        plant: '1120 - HUBLI BRANCH',
        technician_name: 'T4',
        office_under_branch: 'Hubli',
        customer_name: 'C4',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-W-CAD',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Cadbury',
      },
    ],
    clientRows: [
      {
        source_code: 'cadbury',
        region: 'NORTH',
        plant: '1101 - DELHI BRANCH',
        technician_name: 'T5',
        office_under_branch: 'Delhi',
        customer_name: 'C5',
        logged_at: '2026-07-02T00:00:00Z',
        service_order: 'IMP-CAD-OPEN',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        file_name: 'cad.csv',
      },
      {
        source_code: 'coke',
        region: 'SOUTH',
        plant: '1130 - CHENNAI BRANCH',
        technician_name: 'T6',
        office_under_branch: 'Chennai',
        customer_name: 'C6',
        logged_at: '2026-07-02T00:00:00Z',
        service_order: 'IMP-COKE-OPEN',
        client: 'Coke',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        file_name: 'coke.csv',
      },
    ],
    sources: SOURCES,
    agingDate: '2026-07-09',
  });
}

function sheetOpenSum(sheet: { rowCount: number; getRow: (n: number) => { getCell: (c: number) => { value: unknown } } }, openCol: number, startRow: number, endRowExclusive: number): number {
  let sum = 0;
  for (let r = startRow; r < endRowExclusive; r++) {
    sum += Number(sheet.getRow(r).getCell(openCol).value ?? 0);
  }
  return sum;
}

describe('Count parity — BD MIS UI vs BD MIS Excel', () => {
  it('regional UI rows and Summary sheet All open match buildBdMisRegionalRows grand', async () => {
    const crmBranchSummary = sharedCrmBranches();
    const crmAccountSummary = sharedCrmAccounts();
    const clientAccountSummary = sharedClientAccounts();

    const regionalRows = buildBdMisRegionalRows({
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources: SOURCES,
    });
    const grand = sumBdMisRegionalGrand(regionalRows);
    const uiOpen = regionalRows.reduce((s, r) => s + r.open_calls, 0);

    const workbook = await buildBdMisSummaryWorkbook({
      regionalRows,
      grand,
      crmBranchSummary,
      crmAccountSummary,
      clientAccountSummary,
      sources: SOURCES,
      filterMeta,
    });
    const summary = workbook.getWorksheet('Summary');
    expect(summary).toBeDefined();
    const allRow = summary!.getRow(summary!.rowCount);
    expect(allRow.getCell(1).value).toBe('All');
    const excelAllOpen = Number(allRow.getCell(4).value ?? 0);

    expect(uiOpen).toBe(grand.open_calls);
    expect(excelAllOpen).toBe(grand.open_calls);
    expect(excelAllOpen).toBe(uiOpen);
  });
});

describe('Count parity — call-level trace exports', () => {
  it('open-calls Excel rows === filterTraceRowsForOpenExport === included open in summary-aligned traceable', async () => {
    const traceRows = sharedTraceRows();
    const openFilter = filterTraceRowsForOpenExport(traceRows);
    const summaryDetailOpen = countTraceOpenCalls(filterTraceRowsForSummaryExport(traceRows));

    expect(openFilter.length).toBe(summaryDetailOpen);

    const payload = {
      regionalRows: [],
      grand: {
        region: 'ALL' as const,
        total_calls: 0,
        total_solved: 0,
        cancelled_calls: 0,
        open_calls: openFilter.length,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        active_eng: 0,
      },
      crmBranchSummary: sharedCrmBranches(),
      crmAccountSummary: sharedCrmAccounts(),
      clientAccountSummary: sharedClientAccounts(),
      sources: SOURCES,
      traceRows,
      traceAlign: 'summary' as const,
      filterMeta,
    };

    const openWb = await buildBdMisOpenCallsWorkbook(payload);
    const openSheet = openWb.getWorksheet('Row Detail');
    expect((openSheet?.rowCount ?? 1) - 1).toBe(openFilter.length);

    const traceWb = await buildBdMisTraceableWorkbook(payload);
    const traceSheet = traceWb.getWorksheet('Row Detail');
    const traceDataRows = Math.max(0, (traceSheet?.rowCount ?? 1) - 1);
    const traceOpenInSheet = filterTraceRowsForSummaryExport(traceRows).filter(
      (r) => r.counts_toward === 'open'
    ).length;
    expect(traceDataRows).toBe(filterTraceRowsForSummaryExport(traceRows).length);
    expect(traceOpenInSheet).toBe(openFilter.length);
  });
});

describe('Count parity — Summary UI vs Summary Excel', () => {
  it('uiAlign regional/branch opens match Excel Open column when excludeCancelled', async () => {
    const summaryData = sharedCrmBranches();
    const clientAccountSummaryData = sharedClientAccounts().map((a) => ({ ...a }));
    const mergedAccountRows = buildAccountDisplayRows(
      sharedCrmAccounts() as unknown as Array<Record<string, unknown>>,
      clientAccountSummaryData,
      { crm: true, client: true }
    );

    const uiAlign = buildSummaryDashboardExportAlign({
      summaryData,
      clientSummaryData: [],
      clientAccountSummaryData,
      mergedAccountRows,
      mergeFlags: { crm: true, client: true },
      clientMergeWithCrm: { cadbury: true, coke: true },
      clientOnlyMode: false,
    });

    const uiRegionalOpen = uiAlign.regionalRows.reduce((s, r) => s + r.open_calls, 0);
    const uiGrand = sumUiRegionalRows(uiAlign.regionalRows);
    expect(uiGrand.open_calls).toBe(uiRegionalOpen);

    const workbook = await buildSummaryDashboardWorkbook(summaryData, 'Summary Dashboard', {
      excludeCancelled: true,
      uiAlign,
    });
    const sheet = workbook.getWorksheet('Summary Dashboard');
    expect(sheet).toBeDefined();

    // Row1 title, row2 header, then regionalRows, then AI/All style totals follow in export —
    // open column is 4 when excludeCancelled.
    const regionalStart = 3;
    const regionalEnd = regionalStart + uiAlign.regionalRows.length;
    const excelRegionalOpen = sheetOpenSum(sheet!, 4, regionalStart, regionalEnd);
    expect(excelRegionalOpen).toBe(uiRegionalOpen);
  });
});

describe('Count parity — Key Account UI vs Key Account Excel', () => {
  it('display-row open sum matches Key Account workbook Open column', async () => {
    const displayRows = buildAccountDisplayRows(
      sharedCrmAccounts() as unknown as Array<Record<string, unknown>>,
      sharedClientAccounts() as unknown as Array<Record<string, unknown>>,
      { crm: true, client: true }
    );
    const uiOpen = displayRows.reduce((s, r) => s + Number(r.open_calls || 0), 0);

    const workbook = await buildKeyAccountMisWorkbook(
      displayRows as unknown as AccountSummaryRow[],
      undefined,
      { excludeCancelled: true }
    );
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    // Header row 1; data until last; with region shown, open col is 6 when excludeCancelled
    // (Region, Account, Total, Solved, Open, …) — verify via header.
    const header = sheet!.getRow(1);
    let openCol = -1;
    header.eachCell((cell, col) => {
      if (String(cell.value ?? '').toLowerCase().includes('open')) openCol = col;
    });
    expect(openCol).toBeGreaterThan(0);

    let excelOpen = 0;
    for (let r = 2; r <= sheet!.rowCount; r++) {
      const account = sheet!.getRow(r).getCell(2).value;
      if (!account || String(account).toLowerCase() === 'all') continue;
      excelOpen += Number(sheet!.getRow(r).getCell(openCol).value ?? 0);
    }
    expect(excelOpen).toBe(uiOpen);
  });
});

describe('Count parity — digest key-account body vs Key Account Excel', () => {
  it('merged digest account opens match Key Account attachment Open column', async () => {
    const { buildDigestAccountDisplayRows } = await import(
      '@/modules/mis-email/services/fetch-digest-accounts'
    );
    const displayRows = buildDigestAccountDisplayRows(
      sharedCrmAccounts(),
      sharedClientAccounts()
    );
    const bodyOpen = displayRows.reduce((s, r) => s + Number(r.open_calls || 0), 0);

    const workbook = await buildKeyAccountMisWorkbook(
      displayRows as unknown as AccountSummaryRow[],
      'Key Account MIS',
      { excludeCancelled: true }
    );
    const sheet = workbook.getWorksheet('Key Account MIS');
    let openCol = -1;
    sheet!.getRow(1).eachCell((cell, col) => {
      if (String(cell.value ?? '').toLowerCase() === 'open') openCol = col;
    });
    expect(openCol).toBe(6);

    let excelOpen = 0;
    for (let r = 2; r <= sheet!.rowCount; r++) {
      excelOpen += Number(sheet!.getRow(r).getCell(openCol).value ?? 0);
    }
    expect(excelOpen).toBe(bodyOpen);
  });
});
