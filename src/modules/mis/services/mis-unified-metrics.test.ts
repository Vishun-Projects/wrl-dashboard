import { describe, expect, it } from 'vitest';
import type { BdMisTraceRow } from '@/modules/mis/services/bd-mis-trace';
import {
  countUnifiedTraceOpenCalls,
  filterTraceRowsForUnifiedOpenExport,
} from '@/modules/mis/services/mis-unified-metrics';

function traceRow(
  partial: Partial<BdMisTraceRow> & Pick<BdMisTraceRow, 'source' | 'client' | 'counts_toward'>
): BdMisTraceRow {
  return {
    region: 'NORTH ZONE',
    plant: 'Branch',
    technician_name: 'Tech',
    office_under_branch: 'Branch',
    customer_name: 'Customer',
    call_date_time: '2026-01-01',
    service_order: partial.service_order ?? 'SO-1',
    wco: 'W',
    repair_done: '',
    call_status: 'Open',
    aging: '<2 days',
    file_name: partial.source === 'CRM' ? 'CRM Files' : 'Mondelez Files',
    contribution_step: '',
    included_in_final_count: true,
    ...partial,
  };
}

describe('filterTraceRowsForUnifiedOpenExport', () => {
  it('drops CRM Cadbury/Coke open rows and keeps client import open rows', () => {
    const rows = [
      traceRow({ service_order: 'CRM-CAD', source: 'CRM', client: 'Cadbury', counts_toward: 'open' }),
      traceRow({ service_order: 'CRM-ACME', source: 'CRM', client: 'Acme', counts_toward: 'open' }),
      traceRow({ service_order: 'IMP-CAD', source: 'Cadbury', client: 'Cadbury', counts_toward: 'open' }),
      traceRow({ service_order: 'CRM-CAD-CAN', source: 'CRM', client: 'Cadbury', counts_toward: 'cancelled' }),
    ];
    const exported = filterTraceRowsForUnifiedOpenExport(rows);
    expect(exported.map((r) => r.service_order)).toEqual(['CRM-ACME', 'IMP-CAD', 'CRM-CAD-CAN']);
    expect(countUnifiedTraceOpenCalls(rows)).toBe(2);
  });
});
