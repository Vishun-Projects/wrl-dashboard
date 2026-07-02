import { describe, expect, it } from 'vitest';
import { buildBdMisTraceableWorkbook } from '@/lib/report/bd-mis-excel-export';
import type { BdMisTraceRow } from '@/lib/report/bd-mis-trace';

describe('bd-mis-excel-export trace row detail', () => {
  it('uses exact requested row-detail headers and sequence', async () => {
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
        call_status: 'ASSIGNED',
        aging: '<2 days',
        file_name: 'CRM Files',
        source: 'CRM',
        contribution_step: '1. CRM branch base (included)',
        included_in_final_count: true,
        counts_toward: 'open',
      },
    ];

    const workbook = await buildBdMisTraceableWorkbook({
      regionalRows: [],
      grand: {
        region: 'ALL',
        total_calls: 0,
        total_solved: 0,
        cancelled_calls: 0,
        open_calls: 0,
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
      traceRows,
    });

    const rowDetail = workbook.getWorksheet('Row Detail');
    expect(rowDetail).toBeDefined();

    const headerValues = (rowDetail!.getRow(1).values as unknown[]).slice(1);
    expect(headerValues).toEqual([
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
    ]);

    const firstDataRow = (rowDetail!.getRow(2).values as unknown[]).slice(1);
    expect(firstDataRow[0]).toBe('NORTH');
    expect(firstDataRow[1]).toBe('1101 - DELHI BRANCH');
    expect(firstDataRow[2]).toBe('DELHI BRANCH');
    expect(firstDataRow[6]).toBe('26F301654');
  }, 20000);
});
