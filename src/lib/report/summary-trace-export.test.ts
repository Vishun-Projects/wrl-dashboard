import { describe, expect, it } from 'vitest';
import {
  buildUiRegionalPerformanceRows,
  sumUiRegionalRows,
  toBdMisGrandRow,
  toBdMisRegionalRow,
} from '@/lib/report/summary-trace-export';
import type { BranchSummaryRow } from '@/lib/report/summary-derive';

function branch(
  region: string,
  metrics: Partial<BranchSummaryRow> = {}
): BranchSummaryRow {
  return {
    officeId: 1,
    parentId: 0,
    branch: 'TEST',
    region,
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
    ...metrics,
  };
}

describe('summary-trace-export', () => {
  it('merges CRM and client branch totals like the Summary dashboard', () => {
    const crm = [
      branch('EAST ZONE', { total_calls: 100, solved_calls: 40, open_calls: 50 }),
    ];
    const client = [
      branch('EAST ZONE', { total_calls: 20, solved_calls: 5, open_calls: 10 }),
    ];

    const rows = buildUiRegionalPerformanceRows(crm, client, { crm: true, client: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      region: 'EAST ZONE',
      total_calls: 120,
      solved_calls: 45,
      open_calls: 60,
    });

    const grand = toBdMisGrandRow(sumUiRegionalRows(rows));
    expect(grand.total_calls).toBe(120);
    expect(toBdMisRegionalRow(rows[0]).total_solved).toBe(45);
  });
});
