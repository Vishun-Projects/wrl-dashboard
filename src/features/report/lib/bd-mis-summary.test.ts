import { describe, expect, it } from 'vitest';
import type { AccountSummaryRow, BranchSummaryRow } from '@/features/report/lib/summary-derive';
import {
  buildBdMisRegionalBreakdown,
  buildBdMisRegionalRows,
  sumBdMisRegionalGrand,
  sumClientCokeMetricsSouth,
} from '@/features/report/lib/bd-mis-summary';

/** Golden totals from New_BD_MIS_30.06.2026.xlsx Summary sheet. */


function branch(zone: string, total: number, solved = total): BranchSummaryRow {
  const open = Math.max(0, total - solved);
  return {
    officeId: 1,
    parentId: 0,
    branch: 'TEST',
    region: zone,
    total_calls: total,
    solved_calls: solved,
    cancelled_calls: 0,
    open_calls: open,
    age_2: 0,
    age_3: 0,
    age_7: 0,
    age_15: 0,
    part_pending: 0,
    all_total: total,
    all_solved: solved,
    all_cancelled: 0,
    all_open: open,
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
  const open = Math.max(0, total - solved);
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
  it('matches New_BD_MIS Excel Summary union (HCCB snapshot, no CRM Coke subtract)', () => {
    const crmBranches = [
      branch('NORTH ZONE', 56770),
      branch('EAST ZONE', 19465),
      branch('WEST ZONE', 25089),
      branch('SOUTH ZONE', 31735),
    ];
    const crmAccounts = [
      account('NORTH ZONE', 'Cadbury', 1651),
      account('EAST ZONE', 'Cadbury', 7495),
      account('SOUTH ZONE', 'Cadbury', 1205),
      account('SOUTH ZONE', 'Coke', 153),
    ];
    const clientAccounts = [
      account('NORTH ZONE', 'Cadbury', 11636),
      account('EAST ZONE', 'Cadbury', 18161),
      account('SOUTH ZONE', 'Cadbury', 12914),
      account('SOUTH ZONE', 'Coke', 30774),
    ];

    const rows = buildBdMisRegionalRows({
      crmBranchSummary: crmBranches,
      crmAccountSummary: crmAccounts,
      clientAccountSummary: clientAccounts,
      sources: { crm: true, cadbury: true, coke: true },
    });

    expect(rows.find((r) => r.region === 'SOUTH ZONE')!.total_calls).toBe(74218);
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

  it('rolls cancelled calls into regional totals', () => {
    const crmBranches = [
      branch('NORTH ZONE', 100, 80),
      branch('EAST ZONE', 50, 40),
    ];
    crmBranches[0].cancelled_calls = 12;
    crmBranches[0].all_cancelled = 12;
    crmBranches[1].cancelled_calls = 5;
    crmBranches[1].all_cancelled = 5;

    const rows = buildBdMisRegionalRows({
      crmBranchSummary: crmBranches,
      crmAccountSummary: [],
      clientAccountSummary: [],
      sources: { crm: true, cadbury: false, coke: false },
    });

    expect(rows.find((r) => r.region === 'NORTH ZONE')!.cancelled_calls).toBe(12);
    expect(rows.find((r) => r.region === 'EAST ZONE')!.cancelled_calls).toBe(5);
    expect(sumBdMisRegionalGrand(rows).cancelled_calls).toBe(17);
  });

  it('sums open_calls from branch metrics (matches Summary / Register)', () => {
    const rows = buildBdMisRegionalRows({
      crmBranchSummary: [
        branch('NORTH ZONE', 100, 80),
        branch('WEST ZONE', 50, 45),
      ],
      crmAccountSummary: [],
      clientAccountSummary: [],
      sources: { crm: true, cadbury: false, coke: false },
    });
    expect(rows.find((r) => r.region === 'NORTH ZONE')!.open_calls).toBe(20);
    expect(rows.find((r) => r.region === 'WEST ZONE')!.open_calls).toBe(5);
    const grand = sumBdMisRegionalGrand(rows);
    expect(grand.open_calls).toBe(25);
  });

  it('Cadbury import-only + Coke CRM+import open union', () => {
    const crmBranches = [branch('SOUTH ZONE', 1000, 900)];
    crmBranches[0].open_calls = 50;
    const crmAccounts = [
      { ...account('SOUTH ZONE', 'Cadbury', 100, 90), open_calls: 30 },
      { ...account('SOUTH ZONE', 'Coke', 50, 45), open_calls: 20 },
    ];
    const clientAccounts = [
      { ...account('SOUTH ZONE', 'Cadbury', 200, 180), open_calls: 40 },
      { ...account('SOUTH ZONE', 'Coke', 80, 70), open_calls: 10 },
    ];

    const grand = sumBdMisRegionalGrand(
      buildBdMisRegionalRows({
        crmBranchSummary: crmBranches,
        crmAccountSummary: crmAccounts,
        clientAccountSummary: clientAccounts,
        sources: { crm: true, cadbury: true, coke: true },
      })
    );

    // 50 CRM branch open − 30 CRM Cadbury + 40 import Cadbury + 10 import Coke (CRM Coke 20 stays in base)
    expect(grand.open_calls).toBe(50 - 30 + 40 + 10);
  });

  it('excludes CRM Cadbury when excludeCrmCadbury is set (MIS mail)', () => {
    const crmBranches = [branch('EAST ZONE', 1000, 900)];
    crmBranches[0].open_calls = 100;
    const crmAccounts = [{ ...account('EAST ZONE', 'Cadbury', 200, 150), open_calls: 50 }];
    const clientAccounts = [{ ...account('SOUTH ZONE', 'Coke', 80, 70), open_calls: 10 }];

    const grand = sumBdMisRegionalGrand(
      buildBdMisRegionalRows({
        crmBranchSummary: crmBranches,
        crmAccountSummary: crmAccounts,
        clientAccountSummary: clientAccounts,
        sources: { crm: true, cadbury: false, coke: true, excludeCrmCadbury: true },
      })
    );

    // 100 CRM branch open − 50 CRM Cadbury + 10 import Coke (South only)
    expect(grand.open_calls).toBe(100 - 50 + 10);
  });

  it('excludes CRM Cadbury in West when excludeCrmCadbury is set (MIS mail)', () => {
    const crmBranches = [branch('WEST ZONE', 1000, 900)];
    crmBranches[0].open_calls = 50;
    const crmAccounts = [{ ...account('WEST ZONE', 'Cadbury', 200, 150), open_calls: 20 }];

    const west = buildBdMisRegionalRows({
      crmBranchSummary: crmBranches,
      crmAccountSummary: crmAccounts,
      clientAccountSummary: [],
      sources: { crm: true, cadbury: true, coke: true, excludeCrmCadbury: true },
    }).find((r) => r.region === 'WEST ZONE')!;

    expect(west.open_calls).toBe(50 - 20);
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
