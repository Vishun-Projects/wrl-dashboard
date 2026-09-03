import { describe, expect, it } from 'vitest';
import { buildMisEmailRegionalPerformanceRows, countMisEmailOpenParity, misEmailBdMisSources } from '@/modules/mis-email/services/mail-basis';
import { buildMisUnifiedOpenCallsWorkbook } from '@/modules/mis';
import { buildBdMisTraceRows } from '@/modules/mis';
import type { AccountSummaryRow, BranchSummaryRow, SummaryDashboard } from '@/lib/summary/derive';

function branch(zone: string, open: number): BranchSummaryRow {
  return {
    officeId: 1,
    parentId: 0,
    branch: 'TEST',
    region: zone,
    total_calls: 100,
    solved_calls: 100 - open,
    cancelled_calls: 0,
    open_calls: open,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    all_total: 100,
    all_solved: 100 - open,
    all_cancelled: 0,
    all_open: open,
    all_age_2: 0,
    all_age_3: 0,
    all_age_7: 0,
    all_age_15: 0,
    all_part_pending: 0,
    all_tech_solved: 100 - open,
    tech_solved_calls: 100 - open,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    population: 100,
    headcount: 0,
  };
}

function crmAccount(zone: string, name: string, open: number): AccountSummaryRow {
  return {
    region: zone,
    account: name,
    population: 20,
    total_calls: 20,
    total_solved: 20 - open,
    cancelled_calls: 0,
    open_calls: open,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    headcount: 0,
    total_tech_solved: 20 - open,
  };
}

/** Mixed open / solved / CRM-Cadbury (dropped) / Mondelez import (kept). */
function mixedParityTraceRows() {
  return buildBdMisTraceRows({
    crmRows: [
      {
        region: 'NORTH ZONE',
        plant: 'P1',
        technician_name: 'T1',
        office_under_branch: 'B1',
        customer_name: 'C1',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-OPEN-N',
        client: 'Nestle',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Nestle',
      },
      {
        region: 'EAST ZONE',
        plant: 'P2',
        technician_name: 'T2',
        office_under_branch: 'B2',
        customer_name: 'C2',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-OPEN-E',
        client: 'Pepsi',
        call_status: 'Open',
        status_bucket: 'open_unallocated',
        ncancelreason: null,
        account: 'Pepsi',
      },
      {
        region: 'SOUTH ZONE',
        plant: 'P3',
        technician_name: 'T3',
        office_under_branch: 'B3',
        customer_name: 'C3',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-SOLVED',
        client: 'Nestle',
        call_status: 'Solved',
        status_bucket: 'solved',
        ncancelreason: null,
        account: 'Nestle',
      },
      {
        region: 'WEST ZONE',
        plant: 'P4',
        technician_name: 'T4',
        office_under_branch: 'B4',
        customer_name: 'C4',
        logged_at: '2026-07-01T00:00:00Z',
        service_order: 'CRM-CAD-OPEN',
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
        plant: 'P5',
        technician_name: 'T5',
        office_under_branch: 'B5',
        customer_name: 'C5',
        logged_at: '2026-07-02T00:00:00Z',
        service_order: 'IMP-CAD-OPEN',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        file_name: 'cad.csv',
      },
    ],
    sources: misEmailBdMisSources(),
    agingDate: '2026-07-09',
  });
}

describe('MIS email open-count parity (body === Excel)', () => {
  it('regional body open matches open rows in open-export (cancelled listed separately in Excel)', () => {
    const traceRows = mixedParityTraceRows();
    const parity = countMisEmailOpenParity(traceRows);

    expect(parity.regionalBodyOpen).toBe(parity.detailOpenCount);
    expect(parity.branchBodyOpen).toBe(parity.detailOpenCount);
    // Nestle open + Pepsi open + Mondelez import; CRM Cadbury dropped; no cancelled in fixture
    expect(parity.excelOpenRows).toBe(3);
    expect(parity.detailOpenCount).toBe(3);
  });

  it('body Total (solved+open+cancelled) matches summary-aligned trace detail row count', () => {
    const traceRows = mixedParityTraceRows();
    const parity = countMisEmailOpenParity(traceRows);

    expect(parity.regionalBodyCalls).toBe(parity.detailRowCount);
    expect(parity.branchBodyCalls).toBe(parity.detailRowCount);
    expect(parity.regionalBodyCalls).toBe(parity.detailOpenCount + parity.detailSolvedCount);
  });

  it('email HTML Regional Performance All open matches open-calls Excel', async () => {
    const { buildEmailBodySectionsHtml } = await import(
      '@/modules/mis-email/services/body-sections'
    );
    const {
      buildMisEmailRegionalPerformanceRowsFromTrace,
      buildMisEmailBranchPerformanceRowsFromTrace,
    } = await import('@/modules/mis-email/services/mail-basis');

    const traceRows = mixedParityTraceRows();
    const parity = countMisEmailOpenParity(traceRows);
    const regional = buildMisEmailRegionalPerformanceRowsFromTrace(traceRows);
    const branch = buildMisEmailBranchPerformanceRowsFromTrace(traceRows);

    const html = buildEmailBodySectionsHtml(
      ['regional_performance', 'branch_performance'],
      {
        summary: {
          globalHeadcount: 0,
          branchSummary: [],
          accountSummary: [],
        },
        regionalPerformanceRows: regional,
        branchPerformanceRows: branch,
      }
    );

    // Grand open is rendered with en-IN grouping (e.g. 3 or 4,831).
    const openFormatted = parity.excelOpenRows.toLocaleString('en-IN');
    expect(html).toContain(`>${openFormatted}<`);
  });

  it(
    'open-calls Excel workbook data rows match body open total',
    async () => {
    const traceRows = mixedParityTraceRows();
    const parity = countMisEmailOpenParity(traceRows);

    const workbook = await buildMisUnifiedOpenCallsWorkbook({
      regionalRows: [],
      grand: {
        region: 'ALL',
        total_calls: 0,
        total_solved: 0,
        cancelled_calls: 0,
        open_calls: parity.excelOpenRows,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        active_eng: 0,
      },
      crmBranchSummary: [],
      crmAccountSummary: [],
      clientAccountSummary: [],
      sources: misEmailBdMisSources(),
      traceRows,
      traceAlign: 'summary',
      filterMeta: {
        startDate: '2026-01-01',
        endDate: '2026-07-09',
        agingAsOf: '2026-07-09',
        callTypes: 'BREAKDOWN',
        branches: 'All',
        franchisees: 'All',
        sources: misEmailBdMisSources(),
      },
    });

    const sheet = workbook.getWorksheet('Row Detail');
    expect(sheet).toBeDefined();
    // Unified open workbook includes cancelled + open; count Unsolved / open toward only.
    let openRows = 0;
    sheet!.eachRow((row, n) => {
      if (n === 1) return;
      const toward = String(row.getCell(16).value ?? '').toLowerCase();
      if (toward === 'open') openRows += 1;
    });
    expect(openRows).toBe(parity.regionalBodyOpen);
    expect(openRows).toBe(parity.branchBodyOpen);
    expect(openRows).toBe(parity.excelOpenRows);
  },
  30_000
  );

  it('regression: summary body can diverge from Excel; trace body must not', () => {
    // Inflated summary opens (the old email-body path) vs leaner call-level trace.
    const summary: SummaryDashboard = {
      globalHeadcount: 0,
      branchSummary: [
        branch('NORTH ZONE', 50),
        branch('EAST ZONE', 40),
        branch('WEST ZONE', 30),
        branch('SOUTH ZONE', 29),
      ],
      accountSummary: [crmAccount('NORTH ZONE', 'Cadbury', 10)],
    };
    const clientAccounts = [crmAccount('NORTH ZONE', 'Cadbury', 5)];
    const summaryBodyOpen = buildMisEmailRegionalPerformanceRows(summary, clientAccounts).reduce(
      (sum, row) => sum + row.open_calls,
      0
    );

    const traceRows = mixedParityTraceRows();
    const parity = countMisEmailOpenParity(traceRows);

    expect(summaryBodyOpen).toBeGreaterThan(parity.detailOpenCount);
    expect(parity.regionalBodyOpen).toBe(parity.detailOpenCount);
    expect(parity.branchBodyOpen).toBe(parity.detailOpenCount);
  });

  it('branch + key-account rollups count solved, cancelled, and open from the same included trace', async () => {
    const {
      buildMisEmailKeyAccountRowsFromTrace,
      buildMisEmailBranchPerformanceRowsFromTrace,
    } = await import('@/modules/mis-email/services/mail-basis');

    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'T1',
          office_under_branch: 'Ranchi',
          customer_name: 'Nestle Cust',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-OPEN',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'T2',
          office_under_branch: 'Ranchi',
          customer_name: 'Nestle Cust 2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-SOLVED',
          client: 'Nestle',
          call_status: 'Solved',
          status_bucket: 'solved',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'T3',
          office_under_branch: 'Ranchi',
          customer_name: 'Nestle Cust 3',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-CANCEL',
          client: 'Nestle',
          call_status: 'Cancelled',
          status_bucket: 'cancelled',
          ncancelreason: 1,
          account: 'Nestle',
        },
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'T4',
          office_under_branch: 'Ranchi',
          customer_name: 'Mondelez Cust',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-MDLZ-OPEN',
          client: 'Mondelez',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Mondelez',
        },
      ],
      clientRows: [
        {
          source_code: 'cadbury',
          region: 'EAST',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'Imp',
          office_under_branch: 'Ranchi',
          customer_name: 'Import Cust',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'IMP-OPEN',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
        {
          source_code: 'cadbury',
          region: 'EAST',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'Imp2',
          office_under_branch: 'Ranchi',
          customer_name: 'Import Cust 2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'IMP-SOLVED',
          client: 'Cadbury',
          call_status: 'Solved',
          status_bucket: 'solved',
          file_name: 'cad.csv',
        },
      ],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const branch = buildMisEmailBranchPerformanceRowsFromTrace(traceRows).find(
      (row) => row.branch === '1150 - RANCHI BRANCH'
    );
    expect(branch).toBeDefined();
    expect(branch!.open_calls).toBe(2);
    expect(branch!.solved_calls).toBe(2);
    expect(branch!.cancelled_calls).toBe(1);
    expect(branch!.total_calls).toBe(5);

    const accounts = buildMisEmailKeyAccountRowsFromTrace(traceRows);
    const nestle = accounts.find((row) => String(row.account) === 'Nestle');
    const mondelez = accounts.find((row) =>
      ['mondelez', 'cadbury'].includes(String(row.account).toLowerCase())
    );
    expect(nestle).toMatchObject({
      open_calls: 1,
      total_solved: 1,
      cancelled_calls: 1,
      total_calls: 3,
    });
    expect(mondelez).toMatchObject({
      open_calls: 1,
      total_solved: 1,
      cancelled_calls: 0,
      total_calls: 2,
    });
  });

  it('rolls franchisee plant POWER REFRIGERATION into parent Patna, not a fake 1127 branch', async () => {
    const {
      buildMisEmailBranchPerformanceRowsFromTrace,
      resolveTracePlantToWrlBranch,
    } = await import('@/modules/mis-email/services/mail-basis');

    const branchSummary = [
      {
        officeId: 32,
        parentId: 612,
        branch: '1182 - PATNA BRANCH',
        region: 'EAST ZONE',
        total_calls: 0,
        solved_calls: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        all_total: 0,
        all_solved: 0,
        all_cancelled: 0,
        all_open: 0,
        all_age_2: 0,
        all_age_3: 0,
        all_age_7: 0,
        all_age_15: 0,
        all_part_pending: 0,
        all_tech_solved: 0,
        tech_solved_calls: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        active_eng: 0,
        population: 0,
        headcount: 0,
      },
      {
        officeId: 1127,
        parentId: 32,
        branch: 'POWER REFRIGERATION',
        region: 'EAST ZONE',
        total_calls: 0,
        solved_calls: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        all_total: 0,
        all_solved: 0,
        all_cancelled: 0,
        all_open: 0,
        all_age_2: 0,
        all_age_3: 0,
        all_age_7: 0,
        all_age_15: 0,
        all_part_pending: 0,
        all_tech_solved: 0,
        tech_solved_calls: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        active_eng: 0,
        population: 0,
        headcount: 0,
      },
      {
        officeId: 11,
        parentId: 612,
        branch: '1127 - GUWAHATI BRANCH',
        region: 'EAST ZONE',
        total_calls: 0,
        solved_calls: 0,
        cancelled_calls: 0,
        open_calls: 0,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        all_total: 0,
        all_solved: 0,
        all_cancelled: 0,
        all_open: 0,
        all_age_2: 0,
        all_age_3: 0,
        all_age_7: 0,
        all_age_15: 0,
        all_part_pending: 0,
        all_tech_solved: 0,
        tech_solved_calls: 0,
        deployment_total: 0,
        deployment_done: 0,
        installation_total: 0,
        installation_done: 0,
        active_eng: 0,
        population: 0,
        headcount: 0,
      },
    ];

    expect(
      resolveTracePlantToWrlBranch('1127 - POWER REFRIGERATION', 'EAST ZONE', branchSummary)
    ).toEqual({
      branch: '1182 - PATNA BRANCH',
      region: 'EAST ZONE',
    });
    expect(resolveTracePlantToWrlBranch('POWER REFRIGERATION', 'EAST ZONE', branchSummary)).toEqual({
      branch: '1182 - PATNA BRANCH',
      region: 'EAST ZONE',
    });
    expect(
      resolveTracePlantToWrlBranch('1127 - GUWAHATI BRANCH', 'EAST ZONE', branchSummary)
    ).toEqual({
      branch: '1127 - GUWAHATI BRANCH',
      region: 'EAST ZONE',
    });

    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'EAST ZONE',
          plant: '1127 - POWER REFRIGERATION',
          technician_name: 'T1',
          office_under_branch: 'POWER REFRIGERATION',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'PWR-1',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'EAST ZONE',
          plant: '1127 - GUWAHATI BRANCH',
          technician_name: 'T2',
          office_under_branch: 'Guwahati',
          customer_name: 'C2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'GHY-1',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
      ],
      clientRows: [],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const branches = buildMisEmailBranchPerformanceRowsFromTrace(traceRows, branchSummary);
    expect(branches.map((b) => b.branch).sort()).toEqual([
      '1127 - GUWAHATI BRANCH',
      '1182 - PATNA BRANCH',
    ]);
    expect(branches.find((b) => /POWER/i.test(b.branch))).toBeUndefined();
  });
});
