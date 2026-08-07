import { describe, expect, it } from 'vitest';
import {
  buildBdMisOpenCallsWorkbook,
  buildBdMisTraceableWorkbook,
} from '@/modules/mis/services/bd-mis-excel-export';
import type { BdMisTraceRow } from '@/modules/mis/services/bd-mis-trace';

const basePayload = {
  regionalRows: [
    {
      region: 'NORTH ZONE' as const,
      total_calls: 10,
      total_solved: 6,
      cancelled_calls: 0,
      open_calls: 4,
      age_2: 2,
      age_3: 1,
      age_7: 1,
      age_15: 0,
      part_pending: 0,
      active_eng: 100,
    },
  ],
  grand: {
    region: 'ALL' as const,
    total_calls: 10,
    total_solved: 6,
    cancelled_calls: 0,
    open_calls: 4,
    age_2: 2,
    age_3: 1,
    age_7: 1,
    age_15: 0,
    part_pending: 0,
    active_eng: 100,
  },
  crmBranchSummary: [],
  crmAccountSummary: [],
  clientAccountSummary: [],
  sources: { crm: true, cadbury: true, coke: true },
  filterMeta: {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    agingAsOf: '2026-06-30',
    callTypes: 'BREAKDOWN',
    branches: 'All Branches',
    franchisees: 'All Franchisees',
    sources: { crm: true, cadbury: true, coke: true },
  },
};

describe('bd-mis-excel-export trace row detail', () => {
  it('exports row detail only without formulas', async () => {
    const traceRows: BdMisTraceRow[] = [
      {
        region: 'NORTH ZONE',
        office_under_branch: 'DELHI BRANCH',
        plant: '1101 - DELHI BRANCH',
        technician_name: 'TECH A',
        customer_name: 'CUSTOMER A',
        call_date_time: '30.06.2026 10:30',
        service_order: '26F301654',
        client: 'Sarvaraya sugars',
        wco: 'W',
        repair_done: '—',
        call_status: 'ASSIGNED',
        aging: '<2 days',
        file_name: 'CRM Files',
        source: 'CRM',
        contribution_step: '1. CRM branch base (included)',
        included_in_final_count: true,
        counts_toward: 'open',
      },
    ];

    const workbook = await buildBdMisTraceableWorkbook({ ...basePayload, traceRows });
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Row Detail']);
    const rowDetail = workbook.getWorksheet('Row Detail');
    expect(rowDetail).toBeDefined();

    expect(rowDetail!.getRow(1).getCell(9).value).toBe('WCO');
    expect(rowDetail!.getRow(2).getCell(9).value).toBe('W');
    expect(rowDetail!.getRow(1).getCell(10).value).toBe('Repair Done');
    expect(rowDetail!.getRow(2).getCell(10).value).toBe('—');
    const dataCell = rowDetail!.getRow(2).getCell(16);
    expect(dataCell.value).toBe('open');
    expect(dataCell.formula).toBeUndefined();
  }, 30000);

  it('builds open-calls workbook with Unsolved status labels and WCO', async () => {
    const traceRows: BdMisTraceRow[] = [
      {
        region: 'NORTH ZONE',
        office_under_branch: 'DELHI BRANCH',
        plant: '1101 - DELHI BRANCH',
        technician_name: 'TECH A',
        customer_name: 'CUSTOMER A',
        call_date_time: '2026-06-30',
        service_order: 'SO-OPEN',
        client: 'Dealer',
        wco: 'O',
        repair_done: '—',
        call_status: 'ASSIGNED',
        aging: '<2 days',
        file_name: 'CRM Files',
        source: 'CRM',
        contribution_step: '1. CRM branch base (included)',
        included_in_final_count: true,
        counts_toward: 'open',
      },
    ];
    const workbook = await buildBdMisOpenCallsWorkbook({ ...basePayload, traceRows });
    const rowDetail = workbook.getWorksheet('Row Detail');
    expect(rowDetail?.getRow(1).getCell(9).value).toBe('WCO');
    expect(rowDetail?.getRow(2).getCell(9).value).toBe('O');
    expect(rowDetail?.getRow(1).getCell(10).value).toBe('Repair Done');
    expect(rowDetail?.getRow(2).getCell(10).value).toBe('—');
    expect(rowDetail?.getRow(2).getCell(11).value).toBe('Unsolved');
  });
});
