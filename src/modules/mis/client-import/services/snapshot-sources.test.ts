import { describe, expect, it } from 'vitest';
import { SNAPSHOT_IMPORT_SOURCE_CODES, isSnapshotImportSource } from '@/modules/mis/client-import/services/snapshot-sources';
import { normalizeClientRows } from '@/modules/mis/client-import/services/normalize';
import type { MisClientSourceConfig } from '@/modules/mis/client-import/services/types';

const cokeConfig: MisClientSourceConfig = {
  id: 'test',
  code: 'coke',
  name: 'Coke',
  file_kind: 'xlsx',
  delimiter: null,
  header_row_index: 5,
  call_key_column: 'Call No',
  crm_account_filter: 'COKE',
  is_active: true,
  fieldMappings: [
    { client_column: 'Call Log Date', crm_field: 'logged_at', transform: null },
    { client_column: 'Call Status', crm_field: 'status_label', transform: null },
    { client_column: 'Entity Name', crm_field: 'state', transform: null },
  ],
  statusMappings: [
    { client_status: 'Open', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'S.Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Done', status_bucket: 'solved', status_label: 'Closed' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ],
  stateMappings: [
    { client_state: 'Vijaywada Beverage', plan_code: null, region_override: 'SOUTH' },
  ],
};

describe('snapshot import sources', () => {
  it('treats coke and cadbury as full-file snapshots', () => {
    expect(SNAPSHOT_IMPORT_SOURCE_CODES).toEqual(['coke', 'cadbury']);
    expect(isSnapshotImportSource('coke')).toBe(true);
    expect(isSnapshotImportSource('cadbury')).toBe(true);
    expect(isSnapshotImportSource('crm')).toBe(false);
  });
});

describe('coke status mappings', () => {
  it('maps plain Open status to assigned', () => {
    const { rows, errors } = normalizeClientRows(cokeConfig, [
      {
        'Call No': '9001',
        'Call Log Date': '01-06-2026',
        'Call Status': 'Open',
        'Entity Name': 'Vijaywada Beverage',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].status_bucket).toBe('assigned');
  });

  it('counts Service Engg Assigned as open', () => {
    const { rows, errors } = normalizeClientRows(cokeConfig, [
      {
        'Call No': '9002',
        'Call Log Date': '01-06-2026',
        'Call Status': 'Service Engg Assigned',
        'Entity Name': 'Vijaywada Beverage',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0].status_bucket).toBe('assigned');
  });
});
