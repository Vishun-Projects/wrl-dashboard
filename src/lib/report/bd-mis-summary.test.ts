import { describe, expect, it } from 'vitest';
import type { AccountSummaryRow, BranchSummaryRow } from '@/lib/report/summary-derive';
import {
  buildBdMisRegionalBreakdown,
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
  sumClientCokeMetricsSouth,
} from '@/lib/report/bd-mis-summary';

/** Golden totals from BD_MIS_29.06.2026.xlsx Summary sheet / Format.Main union. */
const EXCEL_REGIONAL = {
  'NORTH ZONE': { total: 67657, solved: 65586, open: 2071 },
  'EAST ZONE': { total: 29870, solved: 28546, open: 1324 },
  'WEST ZONE': { total: 24798, solved: 23468, open: 1330 },
  'SOUTH ZONE': { total: 73468, solved: 70740, open: 2728 },
} as const;

function branch(zone: string, total: number, solved = total): BranchSummaryRow {
  return {
    officeId: 1,
    parentId: 0,
    branch: 'TEST',
    region: zone,
    total_calls: total,
    solved_calls: solved,
    cancelled_calls: 0,
    open_calls: 0,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    all_total: total,
    all_solved: solved,
    all_cancelled: 0,
    all_open: 0,
    all_age_2: 0,
    all_age_3: 0,
    all_age_7: 0,
    all_age_15: 0,
    all_part_pending: 0,
    all_tech_solved: solved,
    tech_solved_calls: solved,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 0,
    population: total,
    headcount: 0,
  };
}

function account(
  zone: string,
  name: string,
  total: number,
  solved = total
): AccountSummaryRow {
  return {
    region: zone,
    account: name,
    population: total,
    total_calls: total,
    total_solved: solved,
    cancelled_calls: 0,
    open_calls: 0,
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
    total_tech_solved: solved,
  };
}

describe('buildBdMisRegionalRows', () => {
  it('matches Excel Format.Main union fixture (CRM subset + Mondelez + HCCB)', () => {
    const crmBranches = [
      branch('NORTH ZONE', 57672),
      branch('EAST ZONE', 19204),
      branch('WEST ZONE', 24798),
      branch('SOUTH ZONE', 31583),
    ];
    const crmAccounts = [
      account('NORTH ZONE', 'Cadbury', 1651),
      account('EAST ZONE', 'Cadbury', 7495),
      account('SOUTH ZONE', 'Cadbury', 1334),
      account('SOUTH ZONE', 'Coke', 169),
    ];
    const clientAccounts = [
      account('NORTH ZONE', 'Cadbury', 11636),
      account('EAST ZONE', 'Cadbury', 18161),
      account('SOUTH ZONE', 'Cadbury', 12873),
      account('SOUTH ZONE', 'Coke', 30515),
    ];

    const rows = buildBdMisRegionalRows({
      crmBranchSummary: crmBranches,
      crmAccountSummary: crmAccounts,
      clientAccountSummary: clientAccounts,
      sources: { crm: true, cadbury: true, coke: true },
    });

    for (const row of rows) {
      const ref = EXCEL_REGIONAL[row.region as keyof typeof EXCEL_REGIONAL];
      expect(row.total_calls).toBe(ref.total);
    }

    const grand = sumBdMisRegionalGrand(rows);
    expect(grand.total_calls).toBe(195793);
  });

  it('rolls all Coke client rows into South only', () => {
    const coke = sumClientCokeMetricsSouth([
      account('NORTH ZONE', 'Coke', 1000),
      account('SOUTH ZONE', 'Coke', 2000),
    ]);
    expect(coke.total_calls).toBe(3000);

    const rows = buildBdMisRegionalRows({
      crmBranchSummary: [branch('SOUTH ZONE', 0)],
      crmAccountSummary: [],
      clientAccountSummary: [
        account('NORTH ZONE', 'Coke', 1000),
        account('EAST ZONE', 'Coke', 500),
        account('SOUTH ZONE', 'Coke', 2000),
      ],
      sources: { crm: false, cadbury: false, coke: true },
    });
    const south = rows.find((r) => r.region === 'SOUTH ZONE')!;
    expect(south.total_calls).toBe(3500);
    expect(rows.find((r) => r.region === 'NORTH ZONE')!.total_calls).toBe(0);
  });

  it('breakdown steps sum to regional result', () => {
    const crmBranches = [
      branch('NORTH ZONE', 57672),
      branch('EAST ZONE', 19204),
      branch('WEST ZONE', 24798),
      branch('SOUTH ZONE', 31583),
    ];
    const crmAccounts = [
      account('NORTH ZONE', 'Cadbury', 1651),
      account('EAST ZONE', 'Cadbury', 7495),
      account('SOUTH ZONE', 'Cadbury', 1334),
      account('SOUTH ZONE', 'Coke', 169),
    ];
    const clientAccounts = [
      account('NORTH ZONE', 'Cadbury', 11636),
      account('EAST ZONE', 'Cadbury', 18161),
      account('SOUTH ZONE', 'Cadbury', 12873),
      account('SOUTH ZONE', 'Coke', 30515),
    ];
    const rows = buildBdMisRegionalRows({
      crmBranchSummary: crmBranches,
      crmAccountSummary: crmAccounts,
      clientAccountSummary: clientAccounts,
      sources: { crm: true, cadbury: true, coke: true },
    });
    const breakdown = buildBdMisRegionalBreakdown({
      crmBranchSummary: crmBranches,
      crmAccountSummary: crmAccounts,
      clientAccountSummary: clientAccounts,
      sources: { crm: true, cadbury: true, coke: true },
    });
    for (let i = 0; i < rows.length; i++) {
      expect(breakdown[i].result.total_calls).toBe(rows[i].total_calls);
    }
  });

  it('does not overlay Cadbury client in West', () => {
    const rows = buildBdMisRegionalRows({
      crmBranchSummary: [branch('WEST ZONE', 24798)],
      crmAccountSummary: [account('WEST ZONE', 'Cadbury', 24)],
      clientAccountSummary: [account('WEST ZONE', 'Cadbury', 9999)],
      sources: { crm: true, cadbury: true, coke: false },
    });
    expect(rows.find((r) => r.region === 'WEST ZONE')!.total_calls).toBe(24798);
  });
});
