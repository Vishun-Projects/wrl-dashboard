import { describe, expect, it } from 'vitest';
import type { AccountSummaryRow, BranchSummaryRow, SummaryDashboard } from '@/lib/summary/derive';
import {
  assertMisEmailOpenParity,
  buildMisEmailBranchPerformanceRowsFromTrace,
  buildMisEmailBdMisRegionalPayload,
  buildMisEmailRegionalPerformanceRows,
  buildMisEmailRegionalPerformanceRowsFromTrace,
  misEmailBdMisSources,
  overlayRegionalOpenFromExcelRows,
  reconcileMisEmailOpenCounts,
} from '@/modules/mis-email/services/mail-basis';
import { buildBdMisTraceRows, countTraceOpenCalls, filterTraceRowsForOpenExport } from '@/modules/mis';

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
    all_tech_solved: 0,
    tech_solved_calls: 0,
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
    population: 10,
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
    total_tech_solved: 0,
  };
}

describe('misEmailBdMisSources', () => {
  it('uses Mondelez and Coke imports; CRM Cadbury excluded in all zones', () => {
    expect(misEmailBdMisSources()).toEqual({
      crm: true,
      cadbury: true,
      coke: true,
      excludeCrmCadbury: true,
    });
  });
});

describe('buildMisEmailBdMisRegionalPayload', () => {
  it('subtracts CRM Cadbury, adds Mondelez import and Coke import open calls', () => {
    const summary: SummaryDashboard = {
      globalHeadcount: 0,
      branchSummary: [
        branch('NORTH ZONE', 40),
        branch('EAST ZONE', 30),
        branch('WEST ZONE', 10),
        branch('SOUTH ZONE', 20),
      ],
      accountSummary: [
        crmAccount('NORTH ZONE', 'Cadbury', 15),
        crmAccount('EAST ZONE', 'Mondelez', 10),
      ],
    };
    const clientAccounts = [
      crmAccount('NORTH ZONE', 'Cadbury', 12),
      crmAccount('EAST ZONE', 'Cadbury', 8),
      crmAccount('SOUTH ZONE', 'Coke', 5),
    ];

    const { grand } = buildMisEmailBdMisRegionalPayload(summary, clientAccounts);

    // North 40−15+12, East 30−10+8, West 10, South 20+5
    expect(grand.open_calls).toBe(37 + 28 + 10 + 25);
  });

  it('reconciles summary open with filtered trace open rows', () => {
    const summary: SummaryDashboard = {
      globalHeadcount: 0,
      branchSummary: [branch('NORTH ZONE', 2)],
      accountSummary: [crmAccount('NORTH ZONE', 'Cadbury', 1)],
    };
    const clientAccounts = [crmAccount('NORTH ZONE', 'Cadbury', 1)];
    const { grand } = buildMisEmailBdMisRegionalPayload(summary, clientAccounts);

    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'NORTH ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-CAD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Cadbury',
        },
        {
          region: 'NORTH ZONE',
          plant: 'P2',
          technician_name: 'T2',
          office_under_branch: 'B2',
          customer_name: 'C2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-OTH',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
      ],
      clientRows: [
        {
          source_code: 'cadbury',
          region: 'NORTH',
          plant: 'P3',
          technician_name: 'T3',
          office_under_branch: 'B3',
          customer_name: 'C3',
          logged_at: '2026-07-02T00:00:00Z',
          service_order: 'IMP-CAD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
      ],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const reconciliation = reconcileMisEmailOpenCounts(grand, traceRows);
    expect(reconciliation.matches).toBe(true);
    expect(reconciliation.summaryOpen).toBe(2);
    expect(reconciliation.traceOpenIncluded).toBe(2);
  });

  it('assertMisEmailOpenParity throws on any internal mismatch', () => {
    expect(() =>
      assertMisEmailOpenParity({
        summaryOpen: 4125,
        traceOpenIncluded: 3981,
        delta: -144,
        matches: false,
      })
    ).toThrow(/MIS open-count mismatch/);
  });
});

describe('buildMisEmailRegionalPerformanceRowsFromTrace', () => {
  it('open total matches filtered open-export / reconcile basis', () => {
    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'NORTH ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-OTH',
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
          service_order: 'CRM-SOLVED',
          client: 'Nestle',
          call_status: 'Solved',
          status_bucket: 'solved',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'WEST ZONE',
          plant: 'P3',
          technician_name: 'T3',
          office_under_branch: 'B3',
          customer_name: 'C3',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-CAD',
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
          plant: 'P4',
          technician_name: 'T4',
          office_under_branch: 'B4',
          customer_name: 'C4',
          logged_at: '2026-07-02T00:00:00Z',
          service_order: 'IMP-CAD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
      ],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const regional = buildMisEmailRegionalPerformanceRowsFromTrace(traceRows);
    const bodyOpen = regional.reduce((sum, row) => sum + row.open_calls, 0);
    expect(bodyOpen).toBe(countTraceOpenCalls(filterTraceRowsForOpenExport(traceRows)));
    expect(bodyOpen).toBe(2); // Nestle CRM open + Mondelez import; CRM Cadbury dropped
  });
});

describe('digest body trace basis', () => {
  it('trace body rows align solved/open/cancelled — do not mix summary solved with trace open overlay', () => {
    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'SOUTH ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-SOLVED',
          client: 'Nestle',
          call_status: 'Solved',
          status_bucket: 'solved',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'SOUTH ZONE',
          plant: 'P1',
          technician_name: 'T2',
          office_under_branch: 'B1',
          customer_name: 'C2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'CRM-OPEN',
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

    const fromTrace = buildMisEmailRegionalPerformanceRowsFromTrace(traceRows);
    const summaryRegional = [
      {
        region: 'SOUTH ZONE',
        total_calls: 0,
        solved_calls: 0,
        cancelled_calls: 0,
        open_calls: 99,
        age_2: 0,
        age_3: 0,
        age_7: 0,
        age_15: 0,
        part_pending: 0,
        active_eng: 0,
      },
    ];
    const fromSummaryOverlay = overlayRegionalOpenFromExcelRows(summaryRegional, traceRows);

    expect(fromTrace[0]?.solved_calls).toBe(1);
    expect(fromTrace[0]?.open_calls).toBe(1);
    expect(fromSummaryOverlay[0]?.open_calls).toBe(1);
    // Open-only trace has open rows only — body must keep BdMis solved/cancelled (hybrid), not trace-only.
    expect(fromSummaryOverlay[0]?.solved_calls).toBe(0);
    expect(fromSummaryOverlay[0]?.solved_calls).not.toBe(fromTrace[0]?.solved_calls);
  });
});

describe('overlayRegionalOpenFromExcelRows', () => {
  it('replaces summary open with Excel open and rebalances total_calls', () => {
    const summary: SummaryDashboard = {
      branchSummary: [branch('NORTH', 50), branch('EAST', 50)],
      accountSummary: [],
      globalHeadcount: 0,
    };
    const regional = buildMisEmailRegionalPerformanceRows(summary, []);
    expect(regional.reduce((s, r) => s + r.open_calls, 0)).toBe(100);

    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'NORTH ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'O1',
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
          service_order: 'O2',
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

    const overlaid = overlayRegionalOpenFromExcelRows(regional, traceRows);
    const bodyOpen = overlaid.reduce((s, r) => s + r.open_calls, 0);
    expect(bodyOpen).toBe(countTraceOpenCalls(filterTraceRowsForOpenExport(traceRows)));
    expect(bodyOpen).toBe(2);
    for (const row of overlaid) {
      expect(row.total_calls).toBe(row.solved_calls + row.cancelled_calls + row.open_calls);
    }
  });
});

describe('buildMisEmailBranchPerformanceRowsFromTrace', () => {
  it('builds branch rows from included trace only and sorts by >15 days desc', () => {
    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'NORTH ZONE',
          plant: '1182 - PATNA BRANCH',
          technician_name: 'Tech 1',
          office_under_branch: 'Patna',
          customer_name: 'X',
          logged_at: '2026-06-01T00:00:00Z',
          service_order: 'CRM-1',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'NORTH ZONE',
          plant: '1182 - PATNA BRANCH',
          technician_name: 'Tech 2',
          office_under_branch: 'Patna',
          customer_name: 'Y',
          logged_at: '2026-07-08T00:00:00Z',
          service_order: 'CRM-2',
          client: 'Nestle',
          call_status: 'Solved',
          status_bucket: 'solved',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'NORTH ZONE',
          plant: '1173 - DELHI BRANCH',
          technician_name: 'Tech 3',
          office_under_branch: 'Delhi',
          customer_name: 'Z',
          logged_at: '2026-06-15T00:00:00Z',
          service_order: 'CRM-CAD',
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
          plant: '1173 - DELHI BRANCH',
          technician_name: 'Tech 4',
          office_under_branch: 'Delhi',
          customer_name: 'W',
          logged_at: '2026-06-10T00:00:00Z',
          service_order: 'IMP-CAD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
      ],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const rows = buildMisEmailBranchPerformanceRowsFromTrace(traceRows);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.branch).toBe('1173 - DELHI BRANCH');
    expect(rows[0]?.open_calls).toBe(1); // CRM Cadbury excluded, import Cadbury included
    expect(rows[0]?.age_15).toBe(1);
    expect(rows[1]?.branch).toBe('1182 - PATNA BRANCH');
    expect(rows[1]?.solved_calls).toBe(1);
    expect(rows[1]?.open_calls).toBe(1);
  });

  it('excludes CRM Cadbury/Mondelez from branch >15 days and keeps Mondelez import only', () => {
    const traceRows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'Tech A',
          office_under_branch: 'Ranchi',
          customer_name: 'Nestle Cust',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'CRM-NESTLE-OLD',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'Tech B',
          office_under_branch: 'Ranchi',
          customer_name: 'Cadbury Cust',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'CRM-CADBURY-OLD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Cadbury',
        },
        {
          region: 'EAST ZONE',
          plant: '1150 - RANCHI BRANCH',
          technician_name: 'Tech C',
          office_under_branch: 'Ranchi',
          customer_name: 'Mondelez Cust',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'CRM-MONDELEZ-OLD',
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
          technician_name: 'Tech Imp',
          office_under_branch: 'Ranchi',
          customer_name: 'Import Cust',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'IMP-CAD-OLD',
          client: 'Cadbury',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
      ],
      sources: misEmailBdMisSources(),
      agingDate: '2026-07-09',
    });

    const rows = buildMisEmailBranchPerformanceRowsFromTrace(traceRows);
    const ranchi = rows.find((r) => r.branch === '1150 - RANCHI BRANCH');
    expect(ranchi).toBeTruthy();
    // Nestle CRM (1) + Mondelez import (1) — CRM Cadbury/Mondelez must not count
    expect(ranchi?.open_calls).toBe(2);
    expect(ranchi?.age_15).toBe(2);
  });
});
