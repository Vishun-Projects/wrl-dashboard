import { describe, expect, it } from 'vitest';
import {
  buildBdMisTraceRows,
  filterTraceRowsForExport,
  filterTraceRowsForSummaryExport,
  countTraceOpenCalls,
  formatAgingLabel,
  mapClientCallToTraceRow,
  mapCrmCallToTraceRow,
} from '@/lib/report/bd-mis-trace';

describe('bd-mis-trace', () => {
  it('marks CRM Cadbury rows as subtracted in North', () => {
    const row = mapCrmCallToTraceRow(
      {
        region: 'NORTH ZONE',
        plant: 'Plant A',
        technician_name: 'Tech 1',
        office_under_branch: 'Delhi Branch',
        customer_name: 'Sri Durga',
        logged_at: '2026-03-01T10:00:00Z',
        service_order: 'SO-1',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Cadbury',
      },
      { crm: true, cadbury: true, coke: true },
      '2026-06-29'
    );

    expect(row.included_in_final_count).toBe(false);
    expect(row.contribution_step).toContain('replaced by Cadbury import');
    expect(row.file_name).toBe('CRM Files');
    expect(row.service_order).toBe('SO-1');
  });

  it('marks CRM Cadbury rows as replaced when Mondelez import is on', () => {
    const row = mapCrmCallToTraceRow(
      {
        region: 'NORTH ZONE',
        plant: 'Plant A',
        technician_name: 'Tech 1',
        office_under_branch: 'Delhi Branch',
        customer_name: 'Sri Durga',
        logged_at: '2026-03-01T10:00:00Z',
        service_order: 'SO-1',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Cadbury',
      },
      { crm: true, cadbury: true, coke: true },
      '2026-06-29'
    );

    expect(row.included_in_final_count).toBe(false);
    expect(row.contribution_step).toContain('replaced by Cadbury import');
  });

  it('marks CRM Cadbury rows as excluded from MIS mail when Cadbury import is off', () => {
    const row = mapCrmCallToTraceRow(
      {
        region: 'NORTH ZONE',
        plant: 'Plant A',
        technician_name: 'Tech 1',
        office_under_branch: 'Delhi Branch',
        customer_name: 'Sri Durga',
        logged_at: '2026-03-01T10:00:00Z',
        service_order: 'SO-1',
        client: 'Cadbury',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Cadbury',
      },
      { crm: true, cadbury: false, coke: true, excludeCrmCadbury: true },
      '2026-06-29'
    );

    expect(row.included_in_final_count).toBe(false);
    expect(row.contribution_step).toContain('excluded from MIS mail');
  });

  it('marks client Cadbury rows as added in East', () => {
    const row = mapClientCallToTraceRow(
      {
        source_code: 'cadbury',
        region: 'EAST',
        plant: 'Kolkata',
        technician_name: 'Tech 2',
        office_under_branch: 'West Bengal',
        customer_name: 'Customer B',
        logged_at: '2026-02-15T08:30:00Z',
        service_order: 'T-99',
        client: 'Cadbury',
        call_status: 'Open',
        status_bucket: 'assigned',
        file_name: 'VMSComplaintDetailsRpt.csv',
      },
      { crm: true, cadbury: true, coke: true },
      '2026-06-29'
    );

    expect(row.included_in_final_count).toBe(true);
    expect(row.region).toBe('EAST ZONE');
    expect(row.client).toBe('Mondelez');
    expect(row.file_name).toBe('Mondelez Files');
    expect(row.service_order).toBe('T-99');
  });

  it('rolls Coke import rows to South zone', () => {
    const row = mapClientCallToTraceRow(
      {
        source_code: 'coke',
        region: 'NORTH',
        plant: 'Plant Coke',
        technician_name: 'Tech 3',
        office_under_branch: 'Entity',
        customer_name: 'Customer C',
        logged_at: '2026-04-01T12:00:00Z',
        service_order: 'C-1',
        client: 'Coke',
        call_status: 'Closed',
        status_bucket: 'solved',
        file_name: 'coke.xlsx',
      },
      { crm: true, cadbury: true, coke: true },
      '2026-06-29'
    );

    expect(row.region).toBe('SOUTH ZONE');
    expect(row.client).toBe('HCCB');
    expect(row.file_name).toBe('HCCB Files');
    expect(row.included_in_final_count).toBe(true);
  });

  it('formats aging buckets for open calls', () => {
    expect(formatAgingLabel(1, 'assigned')).toBe('<2 days');
    expect(formatAgingLabel(5, 'assigned')).toBe('3-7 days');
    expect(formatAgingLabel(20, 'open_unallocated')).toBe('>15 days');
    expect(formatAgingLabel(3, 'solved')).toBe('');
  });

  it('builds combined trace rows sorted by region and service order', () => {
    const rows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'WEST ZONE',
          plant: 'P1',
          technician_name: 'T',
          office_under_branch: 'B',
          customer_name: 'Cust 1',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'B-2',
          client: 'Other',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Other',
        },
      ],
      clientRows: [
        {
          source_code: 'cadbury',
          region: 'EAST',
          plant: 'P2',
          technician_name: 'T2',
          office_under_branch: 'B2',
          customer_name: 'Cust 2',
          logged_at: '2026-01-02T00:00:00Z',
          service_order: 'A-1',
          client: 'Cadbury',
          call_status: 'Open',
          status_bucket: 'assigned',
          file_name: 'cad.csv',
        },
      ],
      sources: { crm: true, cadbury: true, coke: false },
      agingDate: '2026-06-29',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].region).toBe('EAST ZONE');
    expect(rows[1].region).toBe('WEST ZONE');
  });

  it('does not leak region labels into branch/plant columns', () => {
    const row = mapClientCallToTraceRow(
      {
        source_code: 'cadbury',
        region: 'EAST',
        plant: 'EAST REGION',
        technician_name: 'Tech 4',
        office_under_branch: 'EAST REGION',
        customer_name: 'Customer D',
        logged_at: '2026-01-03T00:00:00Z',
        service_order: 'D-1',
        client: 'Cadbury',
        call_status: 'Open',
        status_bucket: 'assigned',
        file_name: 'cad.csv',
      },
      { crm: true, cadbury: true, coke: false },
      '2026-06-29'
    );
    expect(row.plant).toBe('—');
    expect(row.office_under_branch).toBe('—');
  });

  it('formats trace call dates as yyyy-mm-dd', () => {
    const row = mapCrmCallToTraceRow(
      {
        region: 'NORTH ZONE',
        plant: 'Plant A',
        technician_name: 'Tech 1',
        office_under_branch: 'Delhi Branch',
        customer_name: 'Sri Durga',
        logged_at: '2026-06-30T10:30:00Z',
        service_order: 'SO-1',
        client: 'Dealer',
        call_status: 'Assigned',
        status_bucket: 'assigned',
        ncancelreason: null,
        account: 'Dealer',
      },
      { crm: true, cadbury: false, coke: false },
      '2026-06-29'
    );

    expect(row.call_date_time).toBe('2026-06-30');
  });

  it('excludes cancelled rows from trace export detail', () => {
    const rows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'EAST ZONE',
          plant: 'P1',
          technician_name: 'T',
          office_under_branch: 'B',
          customer_name: 'Cust 1',
          logged_at: '2026-01-01T00:00:00Z',
          service_order: 'OPEN-1',
          client: 'Other',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Other',
        },
        {
          region: 'EAST ZONE',
          plant: 'P2',
          technician_name: 'T2',
          office_under_branch: 'B2',
          customer_name: 'Cust 2',
          logged_at: '2026-01-02T00:00:00Z',
          service_order: 'CAN-1',
          client: 'Other',
          call_status: 'Cancelled',
          status_bucket: 'cancelled',
          ncancelreason: null,
          account: 'Other',
        },
      ],
      clientRows: [],
      sources: { crm: true, cadbury: false, coke: false },
      agingDate: '2026-06-29',
    });

    expect(rows).toHaveLength(2);
    expect(filterTraceRowsForExport(rows)).toHaveLength(1);
    expect(filterTraceRowsForExport(rows)[0].service_order).toBe('OPEN-1');
  });

  it('filterTraceRowsForSummaryExport drops CRM Cadbury from CRM Files', () => {
    const rows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'NORTH ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'N-1',
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
          service_order: 'N-2',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
      ],
      clientRows: [],
      sources: { crm: true, cadbury: true, coke: true },
      agingDate: '2026-07-09',
    });

    const exported = filterTraceRowsForSummaryExport(rows);
    expect(exported).toHaveLength(1);
    expect(exported[0].client).toBe('Nestle');
    expect(countTraceOpenCalls(exported)).toBe(1);
  });

  it('filterTraceRowsForSummaryExport drops West CRM Cadbury but keeps other closed calls', () => {
    const rows = buildBdMisTraceRows({
      crmRows: [
        {
          region: 'WEST ZONE',
          plant: 'P1',
          technician_name: 'T1',
          office_under_branch: 'B1',
          customer_name: 'C1',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'W-CAD-CLOSED',
          client: 'Cadbury',
          call_status: 'Closed',
          status_bucket: 'solved',
          ncancelreason: null,
          account: 'Cadbury',
        },
        {
          region: 'WEST ZONE',
          plant: 'P2',
          technician_name: 'T2',
          office_under_branch: 'B2',
          customer_name: 'C2',
          logged_at: '2026-07-01T00:00:00Z',
          service_order: 'W-NESTLE-CLOSED',
          client: 'Nestle',
          call_status: 'Closed',
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
          logged_at: '2026-07-02T00:00:00Z',
          service_order: 'W-OPEN',
          client: 'Nestle',
          call_status: 'Assigned',
          status_bucket: 'assigned',
          ncancelreason: null,
          account: 'Nestle',
        },
      ],
      clientRows: [],
      sources: { crm: true, cadbury: true, coke: true, excludeCrmCadbury: true },
      agingDate: '2026-07-09',
    });

    const exported = filterTraceRowsForSummaryExport(rows);
    expect(exported.map((r) => r.service_order)).toEqual(['W-NESTLE-CLOSED', 'W-OPEN']);
    expect(countTraceOpenCalls(exported)).toBe(1);
  });
});
