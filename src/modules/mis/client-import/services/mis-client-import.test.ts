import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { dedupeClientRowsLatestBatchWins } from '@/modules/mis/client-import/services/aggregate';
import { buildImportFilePath } from '@/modules/mis/client-import/services/file-store';
import { mergedMetricValue, findAccountMetric, mergeSelectedMetrics, rollupAccountsByAccount, accountMergeFlags, filterTopAccountsByZone, accountRowScore, isAccountExcludedFromZoneTop, DEFAULT_CLIENT_MERGE_WITH_CRM, type ClientMergeWithCrmPrefs } from '@/modules/mis';
import { parsePipeDelimitedCsv, decodeCsvBuffer } from '@/modules/mis/client-import/services/parse-csv';
import { parseClientDate } from '@/modules/mis/client-import/services/parse-dates';
import { normalizeClientRows } from '@/modules/mis/client-import/services/normalize';
import { formatDisplayRegion, isKnownZone, normalizeClientRegion } from '@/modules/mis/client-import/services/region';
import { parseSourceCodesParam, sourceCodesToParam } from '@/modules/mis/client-import/services/source-selection';
import {
  isCadburyExcludedServiceProvider,
  shouldSkipCadburyImportRow,
} from '@/modules/mis/client-import/services/cadbury-filters';
import { isRegisterRowSolvedForMis } from '@/modules/mis';
import {
  detectFileFormat,
  parseImportFile,
  sniffSourceFromHeaders,
  sourceMismatchMessage,
} from '@/modules/mis/client-import/services/detect-parse';
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
    { client_column: 'Customer Name', crm_field: 'branch_name', transform: null },
    { client_column: 'Complaint Description', crm_field: 'complaint', transform: null },
  ],
  statusMappings: [
    { client_status: 'S.Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ],
  stateMappings: [
    { client_state: 'Vijaywada Beverage', plan_code: null, region_override: 'SOUTH' },
  ],
};

describe('parsePipeDelimitedCsv', () => {
  it('parses pipe-delimited header and first rows', () => {
    const lines = [
      '".TicketNumber"|"CallStatus"|"State"',
      '"1180695"|"Open"|"MAHARASHTRA"',
      '"1180696"|"Closed"|"GUJARAT"',
    ].join('\n');
    const { headers, rows } = parsePipeDelimitedCsv(lines, '|');
    expect(headers).toContain('.TicketNumber');
    expect(headers).toContain('CallStatus');
    expect(rows.length).toBe(2);
    expect(rows[0]?.['.TicketNumber']).toBe('1180695');
    expect(rows[0]?.CallStatus).toBe('Open');
  });

  it.skipIf(!existsSync(join(process.cwd(), 'VMSComplaintDetailsRpt.csv')))(
    'parses Cadbury VMS sample header and first row from local file',
    () => {
      const samplePath = join(process.cwd(), 'VMSComplaintDetailsRpt.csv');
      const buffer = readFileSync(samplePath);
      const content = decodeCsvBuffer(buffer);
      const lines = content.split(/\r?\n/).slice(0, 3).join('\n');
      const { headers, rows } = parsePipeDelimitedCsv(lines, '|');
      expect(headers).toContain('.TicketNumber');
      expect(headers).toContain('CallStatus');
      expect(rows.length).toBe(2);
      expect(rows[0]?.['.TicketNumber']).toBe('1180695');
      expect(rows[0]?.CallStatus).toBe('Open');
    }
  );

  it('parses UTF-16 LE pipe CSV exports from Excel', () => {
    const line =
      '".TicketNumber"|"VDate"|"CallStatus"|"State"\r\n"9001"|"Jun 25 2026 11:04AM"|"Open"|"MAHARASHTRA"';
    const buffer = Buffer.from('\ufeff' + line, 'utf16le');
    const content = decodeCsvBuffer(buffer);
    const { headers, rows } = parsePipeDelimitedCsv(content, '|');
    expect(headers).toEqual(['.TicketNumber', 'VDate', 'CallStatus', 'State']);
    expect(rows[0]['.TicketNumber']).toBe('9001');
    expect(rows[0].CallStatus).toBe('Open');
  });
});

describe('parseClientDate', () => {
  it('parses Coke VDate format', () => {
    const d = parseClientDate('Jun 25 2026 11:04AM');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
  });

  it('parses Cadbury DD-MM-YYYY format', () => {
    const d = parseClientDate('29-12-2025');
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(11);
    expect(d!.getDate()).toBe(29);
  });

  it('parses Excel serial day numbers', () => {
    const d = parseClientDate(46020);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it('parses dd/mm/yyyy slash format (Coke CDMS)', () => {
    const d = parseClientDate('29/12/2025');
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(29);
    expect(d!.getMonth()).toBe(11);
  });

  it('parses 07/01/2026 as 7 Jan not 1 Jul (dd/mm before US Date)', () => {
    const d = parseClientDate('07/01/2026');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(7);
  });
});

describe('normalizeClientRows', () => {
  it('maps Coke CDMS rows to normalized shape', () => {
    const { rows, errors } = normalizeClientRows(cokeConfig, [
      {
        'Call No': '1001',
        'Call Log Date': '29-12-2025',
        'Call Status': 'Service Engg Assigned',
        'Entity Name': 'Vijaywada Beverage',
        'Customer Name': 'Store A',
        'Complaint Description': 'No Cooling',
      },
      {
        'Call No': '1002',
        'Call Log Date': '30-12-2025',
        'Call Status': 'Closed',
        'Entity Name': 'Vijaywada Beverage',
        'Customer Name': 'Store B',
        'Complaint Description': 'PART pending issue',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].status_bucket).toBe('assigned');
    expect(rows[0].region).toBe('SOUTH');
    expect(rows[1].status_bucket).toBe('solved');
  });

  it('maps Coke CDMS statuses: Closed/Service Done solved, Service Engg Assigned open', () => {
    const config: MisClientSourceConfig = {
      ...cokeConfig,
      statusMappings: [
        { client_status: 'Open', status_bucket: 'assigned', status_label: 'Assigned' },
        { client_status: 'Service Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
        { client_status: 'Service Done', status_bucket: 'solved', status_label: 'Closed' },
        { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
      ],
    };
    const { rows, errors } = normalizeClientRows(config, [
      { 'Call No': '1', 'Call Status': 'Closed', 'Entity Name': 'Vijaywada Beverage' },
      { 'Call No': '2', 'Call Status': 'Service Done', 'Entity Name': 'Vijaywada Beverage' },
      { 'Call No': '3', 'Call Status': 'Service Engg Assigned', 'Entity Name': 'Vijaywada Beverage' },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows.find((r) => r.call_key === '1')?.status_bucket).toBe('solved');
    expect(rows.find((r) => r.call_key === '2')?.status_bucket).toBe('solved');
    expect(rows.find((r) => r.call_key === '3')?.status_bucket).toBe('assigned');
  });
});

describe('normalizeClientRegion', () => {
  it('normalizes cardinal directions', () => {
    expect(normalizeClientRegion('West')).toBe('WEST');
    expect(normalizeClientRegion('North BSM 1')).toBe('NORTH');
  });

  it('returns OTHER for person names or unknown labels', () => {
    expect(normalizeClientRegion('A N K AMAR BABU')).toBe('OTHER');
  });
});

describe('formatDisplayRegion', () => {
  it('formats zones like CRM Key Account labels', () => {
    expect(formatDisplayRegion('SOUTH')).toBe('SOUTH ZONE');
    expect(formatDisplayRegion('NORTH')).toBe('NORTH ZONE');
  });

  it('maps unknown values to OTHER', () => {
    expect(formatDisplayRegion('A N K AMAR BABU')).toBe('OTHER');
    expect(isKnownZone('OTHER')).toBe(false);
  });
});

describe('parseSourceCodesParam', () => {
  it('parses comma-separated source codes', () => {
    expect(parseSourceCodesParam('coke,cadbury')).toEqual(['coke', 'cadbury']);
    expect(parseSourceCodesParam('')).toBeNull();
  });

  it('round-trips via sourceCodesToParam', () => {
    expect(sourceCodesToParam(['coke', 'cadbury'])).toBe('coke,cadbury');
    expect(sourceCodesToParam([])).toBeUndefined();
  });
});

describe('mergeSelectedMetrics', () => {
  it('returns client only when CRM is off', () => {
    expect(mergeSelectedMetrics(100, 25, { crm: false, client: true })).toBe(25);
  });

  it('returns CRM only when client sources are off', () => {
    expect(mergeSelectedMetrics(100, 25, { crm: true, client: false })).toBe(100);
  });

  it('merges when both are on', () => {
    expect(mergeSelectedMetrics(100, 25, { crm: true, client: true })).toBe(125);
  });
});

const cadburyConfig: MisClientSourceConfig = {
  id: 'cadbury-test',
  code: 'cadbury',
  name: 'Cadbury',
  file_kind: 'csv',
  delimiter: '|',
  header_row_index: 1,
  call_key_column: '.TicketNumber',
  crm_account_filter: 'CADBURY',
  is_active: true,
  fieldMappings: [
    { client_column: 'VDate', crm_field: 'logged_at', transform: null },
    { client_column: 'CallStatus', crm_field: 'status_label', transform: null },
    { client_column: 'Branchname', crm_field: 'region', transform: null },
    { client_column: 'State', crm_field: 'state', transform: null },
    { client_column: 'Town', crm_field: 'branch_name', transform: null },
    { client_column: 'Details', crm_field: 'complaint', transform: null },
  ],
  statusMappings: [
    { client_status: 'Open', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Close', status_bucket: 'solved', status_label: 'Closed' },
  ],
  stateMappings: [
    { client_state: 'MAHARASHTRA', plan_code: null, region_override: 'WEST' },
  ],
};

describe('Cadbury service provider filter', () => {
  it('flags excluded ASP names', () => {
    expect(isCadburyExcludedServiceProvider('Span Spectrum Pvt Ltd')).toBe(true);
    expect(isCadburyExcludedServiceProvider('Punjab Refrigeration')).toBe(true);
    expect(isCadburyExcludedServiceProvider('Western Refrigeration')).toBe(false);
    expect(isCadburyExcludedServiceProvider('Singh Refrigeration')).toBe(false);
  });

  it('skips excluded providers during Cadbury normalize', () => {
    const baseRow = {
      '.TicketNumber': '1',
      VDate: 'Jun 25 2026 11:04AM',
      CallStatus: 'Open',
      Branchname: 'West',
      State: 'MAHARASHTRA',
      Town: 'Mumbai',
      Details: 'No Cooling',
    };
    const { rows, warnings } = normalizeClientRows(cadburyConfig, [
      { ...baseRow, '.TicketNumber': '100', Service_Provider: 'Span Spectrum Pvt Ltd' },
      { ...baseRow, '.TicketNumber': '101', Service_Provider: 'Western Refrigeration' },
      { ...baseRow, '.TicketNumber': '102', Service_Provider: 'Punjab Refrigeration' },
      { ...baseRow, '.TicketNumber': '103', Service_Provider: 'Technocreat' },
    ]);
    expect(rows.map((r) => r.call_key)).toEqual(['101', '103']);
    expect(shouldSkipCadburyImportRow('coke', { Service_Provider: 'Span Spectrum Pvt Ltd' })).toBe(
      false
    );
    expect(warnings.some((w) => w.includes('Excluded 2 rows'))).toBe(true);
  });
});

describe('Coke region from Entity Name', () => {
  it('resolves region from entity state mapping, not ASM names', () => {
    const { rows, errors } = normalizeClientRows(cokeConfig, [
      {
        'Call No': '9001',
        'Entity Name': 'Vijaywada Beverage',
        'Call Status': 'Service Engg Assigned',
        'ASM Name': 'A N K AMAR BABU',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0].state).toBe('Vijaywada Beverage');
    expect(rows[0].region).toBe('SOUTH');
    expect(formatDisplayRegion(rows[0].region)).toBe('SOUTH ZONE');
  });

  it('overrides ASM Name region mapping using Entity Name state table', () => {
    const badConfig: MisClientSourceConfig = {
      ...cokeConfig,
      fieldMappings: [
        ...cokeConfig.fieldMappings.filter((m) => m.crm_field !== 'state'),
        { client_column: 'ASM Name', crm_field: 'region', transform: null },
      ],
    };
    const { rows, errors } = normalizeClientRows(badConfig, [
      {
        'Call No': '9002',
        'Entity Name': 'Vijaywada Beverage',
        'Call Status': 'Service Engg Assigned',
        'ASM Name': 'P L N Sirish',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0].region).toBe('SOUTH');
  });
});

describe('canUploadClientMis / canDeleteClientMis', () => {
  it('checks RBAC capabilities', async () => {
    const { canUploadClientMis, canDeleteClientMis } = await import(
      '@/modules/mis/client-import/services/upload-access'
    );
    expect(canUploadClientMis(['mis_client_import_upload'])).toBe(true);
    expect(canUploadClientMis(['tab_mis_client_import'])).toBe(false);
    expect(canDeleteClientMis(['mis_client_import_delete'])).toBe(true);
    expect(canDeleteClientMis([])).toBe(false);
  });
});

describe('dedupeClientRowsLatestBatchWins', () => {
  const base = {
    account: 'Coke',
    region: 'WEST',
    branch_label: 'Mumbai',
    logged_at: new Date('2026-06-01'),
    status_bucket: 'assigned' as const,
    is_part_pending: false,
    engineer_name: 'Eng A',
  };

  it('keeps latest batch row per source+call_key', () => {
    const older = new Date('2026-06-01T10:00:00Z');
    const newer = new Date('2026-06-02T10:00:00Z');
    const rows = dedupeClientRowsLatestBatchWins([
      { ...base, source_id: 'coke', call_key: '1001', batch_created_at: older, engineer_name: 'Old' },
      { ...base, source_id: 'coke', call_key: '1001', batch_created_at: newer, engineer_name: 'New' },
      { ...base, source_id: 'coke', call_key: '1002', batch_created_at: older },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.engineer_name === 'New')).toBeTruthy();
    expect(rows.find((r) => r.engineer_name === 'Old')).toBeFalsy();
  });

  it('reverts to older batch when newer batch is removed', () => {
    const batchA = new Date('2026-06-01T10:00:00Z');
    const batchB = new Date('2026-06-02T10:00:00Z');
    const withBoth = [
      { ...base, source_id: 'coke', call_key: '1001', batch_created_at: batchA, engineer_name: 'From A' },
      { ...base, source_id: 'coke', call_key: '1001', batch_created_at: batchB, engineer_name: 'From B' },
    ];
    expect(dedupeClientRowsLatestBatchWins(withBoth)[0].engineer_name).toBe('From B');

    const afterDeleteB = withBoth.filter((r) => r.batch_created_at !== batchB);
    expect(dedupeClientRowsLatestBatchWins(afterDeleteB)[0].engineer_name).toBe('From A');
  });

  it('aggregates independent keys across sources for overall view', () => {
    const t = new Date('2026-06-01T10:00:00Z');
    const rows = dedupeClientRowsLatestBatchWins([
      { ...base, source_id: 'coke', call_key: 'C1', batch_created_at: t },
      { ...base, source_id: 'cadbury', call_key: 'D1', batch_created_at: t, region: 'SOUTH' },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('mergedMetricValue', () => {
  it('adds CRM and client when overall is enabled', () => {
    expect(mergedMetricValue(100, 20, true)).toBe(120);
  });

  it('shows CRM only when overall is disabled', () => {
    expect(mergedMetricValue(100, 20, false)).toBe(100);
  });

  it('shows CRM only when no client data', () => {
    expect(mergedMetricValue(100, 0, true)).toBe(100);
  });
});

describe('rollupAccountsByAccount', () => {
  it('sums metrics across zones for the same account', () => {
    const rolled = rollupAccountsByAccount([
      { region: 'WEST ZONE', account: 'UB', total_calls: 10, age_2: 2, headcount: 100 },
      { region: 'NORTH ZONE', account: 'UB', total_calls: 5, age_2: 1, headcount: 120 },
      { region: 'SOUTH ZONE', account: 'Vadilal', total_calls: 3, age_2: 0, headcount: 50 },
    ]);
    expect(rolled).toHaveLength(2);
    const ub = rolled.find((r) => r.account === 'UB');
    expect(ub?.region).toBe('All India');
    expect(ub?.total_calls).toBe(15);
    expect(ub?.age_2).toBe(3);
    expect(ub?.headcount).toBe(120);
  });
});

describe('accountMergeFlags', () => {
  const global = { crm: true, client: true };
  const noMerge: ClientMergeWithCrmPrefs = { ...DEFAULT_CLIENT_MERGE_WITH_CRM };
  const cadburyMerge: ClientMergeWithCrmPrefs = { cadbury: true, coke: false };
  const cokeMerge: ClientMergeWithCrmPrefs = { cadbury: false, coke: true };

  it('defaults Cadbury to import-only', () => {
    expect(accountMergeFlags('Cadbury', global, noMerge)).toEqual({ crm: false, client: true });
    expect(accountMergeFlags('CADBURY', global, noMerge)).toEqual({ crm: false, client: true });
  });

  it('defaults Coke to import-only', () => {
    expect(accountMergeFlags('Coke', global, noMerge)).toEqual({ crm: false, client: true });
    expect(accountMergeFlags('COKE', global, noMerge)).toEqual({ crm: false, client: true });
  });

  it('merges Cadbury with CRM when enabled', () => {
    expect(accountMergeFlags('Cadbury', global, cadburyMerge)).toEqual(global);
  });

  it('merges Coke with CRM when enabled', () => {
    expect(accountMergeFlags('Coke', global, cokeMerge)).toEqual(global);
  });

  it('does not affect other accounts', () => {
    expect(accountMergeFlags('UB', global, noMerge)).toEqual(global);
  });
});

describe('resolveSummaryRegionMetric', () => {
  it('matches Key Account Cadbury merge rules per region', async () => {
    const { resolveSummaryRegionMetric } = await import('@/modules/mis/components/SummaryMergedMetricCell');
    const accounts = [
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 100 },
      { region: 'SOUTH ZONE', account: 'Coke', total_calls: 50 },
    ];
    const clientAccounts = [
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 40 },
      { region: 'SOUTH ZONE', account: 'Coke', total_calls: 10 },
    ];
    const global = { crm: true, client: true };

    const noMerge: ClientMergeWithCrmPrefs = { cadbury: false, coke: false };
    const cadburyMerge: ClientMergeWithCrmPrefs = { cadbury: true, coke: false };

    const withoutMerge = resolveSummaryRegionMetric(
      true,
      accounts,
      clientAccounts,
      'SOUTH',
      'total_calls',
      global,
      noMerge,
      0,
      0
    );
    expect(withoutMerge.crm).toBe(50);

    const withMerge = resolveSummaryRegionMetric(
      true,
      accounts,
      clientAccounts,
      'SOUTH',
      'total_calls',
      global,
      cadburyMerge,
      0,
      0
    );
    expect(withMerge.crm).toBe(150);
  });
});

describe('filterTopAccountsByZone', () => {
  const rows = [
    { region: 'WEST ZONE', account: 'A', total_calls: 10 },
    { region: 'WEST ZONE', account: 'B', total_calls: 50 },
    { region: 'WEST ZONE', account: 'C', total_calls: 30 },
    { region: 'NORTH ZONE', account: 'X', total_calls: 5 },
    { region: 'NORTH ZONE', account: 'Y', total_calls: 40 },
  ];

  it('keeps top N per zone by score', () => {
    const top2 = filterTopAccountsByZone(rows, 2, (r) => Number(r.total_calls));
    expect(top2.map((r) => `${r.region}:${r.account}`)).toEqual([
      'NORTH ZONE:Y',
      'NORTH ZONE:X',
      'WEST ZONE:B',
      'WEST ZONE:C',
    ]);
  });

  it('drops excluded accounts before ranking', () => {
    const withDealer = [
      ...rows,
      { region: 'WEST ZONE', account: 'DEALER', total_calls: 999 },
      { region: 'NORTH ZONE', account: 'GENERAL', total_calls: 888 },
    ];
    const top2 = filterTopAccountsByZone(
      withDealer,
      2,
      (r) => Number(r.total_calls),
      ['DEALER', 'GENERAL']
    );
    expect(top2.some((r) => String(r.account).toUpperCase() === 'DEALER')).toBe(false);
    expect(top2.some((r) => String(r.account).toUpperCase() === 'GENERAL')).toBe(false);
    expect(top2.map((r) => `${r.region}:${r.account}`)).toEqual([
      'NORTH ZONE:Y',
      'NORTH ZONE:X',
      'WEST ZONE:B',
      'WEST ZONE:C',
    ]);
  });
});

describe('isAccountExcludedFromZoneTop', () => {
  it('matches case-insensitively', () => {
    expect(isAccountExcludedFromZoneTop('Dealer', ['DEALER'])).toBe(true);
    expect(isAccountExcludedFromZoneTop('UB', ['DEALER', 'GENERAL'])).toBe(false);
  });
});

describe('accountRowScore', () => {
  it('uses import-only Cadbury score when merge is off', () => {
    const crmRow = { region: 'WEST', account: 'Cadbury', total_calls: 100 };
    const client = [{ region: 'WEST', account: 'Cadbury', total_calls: 20 }];
    const global = { crm: true, client: true };
    const noMerge: ClientMergeWithCrmPrefs = { cadbury: false, coke: false };
    const cadburyMerge: ClientMergeWithCrmPrefs = { cadbury: true, coke: false };
    expect(accountRowScore(crmRow, client, global, noMerge)).toBe(20);
    expect(accountRowScore(crmRow, client, global, cadburyMerge)).toBe(120);
  });

  it('uses import-only Coke score when merge is off', () => {
    const crmRow = { region: 'SOUTH', account: 'Coke', total_calls: 50 };
    const client = [{ region: 'SOUTH', account: 'COKE', total_calls: 30 }];
    const global = { crm: true, client: true };
    const noMerge: ClientMergeWithCrmPrefs = { cadbury: false, coke: false };
    expect(accountRowScore(crmRow, client, global, noMerge)).toBe(30);
  });
});

describe('findAccountMetric', () => {
  const clientAccounts = [
    { region: 'WEST', account: 'Coke', total_calls: 50, total_solved: 30 },
    { region: 'NORTH ZONE', account: 'Cadbury', total_calls: 20, total_solved: 10 },
  ];

  it('matches region and account for client import rows', () => {
    expect(findAccountMetric(clientAccounts, 'WEST', 'Coke', 'total_calls')).toBe(50);
    expect(findAccountMetric(clientAccounts, 'NORTH', 'Cadbury', 'total_solved')).toBe(10);
  });

  it('does not match partial account names', () => {
    expect(findAccountMetric(clientAccounts, 'WEST', 'Coke Oya', 'total_calls')).toBe(0);
  });

  it('does not double-count regions with fuzzy substring overlap', () => {
    const branches = [
      { region: 'NORTH', account: 'Coke', total_calls: 10 },
      { region: 'NORTH EAST', account: 'Coke', total_calls: 5 },
    ];
    expect(findAccountMetric(branches, 'NORTH', 'Coke', 'total_calls')).toBe(10);
    expect(findAccountMetric(branches, 'NORTH EAST', 'Coke', 'total_calls')).toBe(5);
  });
});

const cokeConfigFull: MisClientSourceConfig = {
  ...cokeConfig,
  header_row_index: 5,
  statusMappings: [
    { client_status: 'Open', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'S.Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Engg Assigned', status_bucket: 'assigned', status_label: 'Assigned' },
    { client_status: 'Service Done', status_bucket: 'solved', status_label: 'Closed' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ],
  stateMappings: [
    { client_state: 'Ameenpur Beverage', plan_code: '1162', region_override: 'SOUTH' },
    { client_state: 'Moula Ali Beverage', plan_code: '1162', region_override: 'SOUTH' },
    { client_state: 'Vijaywada Beverage', plan_code: '1181', region_override: 'SOUTH' },
    { client_state: 'Vizag Beverage', plan_code: '1181', region_override: 'SOUTH' },
    { client_state: 'Chittoor Beverage', plan_code: '1181', region_override: 'SOUTH' },
  ],
};

describe('detect-parse', () => {
  const cdmsPath = join(process.cwd(), 'CDMS_CallStatus_Detailed (37).xlsx');
  const vmsCsvPath = join(process.cwd(), 'VMSComplaintDetailsRpt.csv');
  const hasCdms = existsSync(cdmsPath);
  const hasVms = existsSync(vmsCsvPath);

  it('sniffs Coke CDMS headers', () => {
    expect(
      sniffSourceFromHeaders(['Sr.No', 'Entity Name', 'Call No', 'Call Status', 'Call Log Date'])
    ).toBe('coke');
  });

  it('sniffs Cadbury VMS headers', () => {
    expect(
      sniffSourceFromHeaders(['.TicketNumber', 'VDate', 'Branchname', 'CallStatus'])
    ).toBe('cadbury');
  });

  it('detects spreadsheet format from xlsx magic bytes', () => {
    // ZIP/OOXML signature is enough for spreadsheet sniffing without sample files.
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectFileFormat(buf, 'report.xlsx')).toBe('spreadsheet');
  });

  it('detects csv format from text buffer', () => {
    const buf = Buffer.from('".TicketNumber"|"CallStatus"\n"1"|"Open"\n', 'utf8');
    expect(detectFileFormat(buf, 'VMSComplaintDetailsRpt.csv')).toBe('csv');
  });

  it.skipIf(!hasCdms)(
    'parses CDMS xlsx as Coke with thousands of rows',
    async () => {
      const buf = readFileSync(cdmsPath);
      const result = await parseImportFile(buf, 'CDMS_CallStatus_Detailed (37).xlsx', cokeConfigFull);
      expect(result.sniffedSource).toBe('coke');
      expect(result.detectedHeaderRow).toBe(5);
      expect(result.rawRows.length).toBeGreaterThan(1000);
      expect(result.rawRows[0]?.['Call No']).toBeTruthy();
    },
    120_000
  );

  it.skipIf(!hasCdms)(
    'auto-finds header row 5 when config header row is wrong',
    async () => {
      const buf = readFileSync(cdmsPath);
      const wrongHeader = { ...cokeConfigFull, header_row_index: 1 };
      const result = await parseImportFile(buf, 'CDMS_CallStatus_Detailed (37).xlsx', wrongHeader);
      expect(result.sniffedSource).toBe('coke');
      expect(result.rawRows.length).toBeGreaterThan(1000);
      expect(result.detectedHeaderRow).toBe(5);
      expect(result.warnings.some((w) => w.includes('Auto-detected header row 5'))).toBe(true);
    },
    120_000
  );

  it.skipIf(!hasVms)('parses Cadbury VMS csv with cadbury config', async () => {
    const buf = readFileSync(vmsCsvPath);
    const result = await parseImportFile(buf, 'VMSComplaintDetailsRpt.csv', cadburyConfig);
    expect(result.sniffedSource).toBe('cadbury');
    expect(result.detectedFormat).toBe('csv');
    expect(result.rawRows.length).toBeGreaterThan(100);
    expect(result.rawRows[0]?.['.TicketNumber']).toBeTruthy();
  });

  it.skipIf(!hasVms)('parses Cadbury VMS csv with thousands of rows end-to-end', async () => {
    const buf = readFileSync(vmsCsvPath);
    const rawRows = (
      await parseImportFile(buf, 'VMSComplaintDetailsRpt.csv', cadburyConfig)
    ).rawRows.slice(0, 50);
    const { rows, errors, warnings } = normalizeClientRows(cadburyConfig, rawRows);
    expect(errors).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(rawRows.length);
    expect(rows.every((r) => !isCadburyExcludedServiceProvider(r.raw.Service_Provider ?? ''))).toBe(
      true
    );
    expect(warnings.some((w) => w.includes('Span Spectrum Pvt Ltd'))).toBe(true);
    expect(rows[0]?.call_key).toBeTruthy();
    expect(rows[0]?.region).toBeTruthy();
  });

  it.skipIf(!hasCdms)(
    'parses Coke CDMS xlsx with thousands of rows end-to-end',
    async () => {
      const buf = readFileSync(cdmsPath);
      const rawRows = (await parseImportFile(buf, 'CDMS_CallStatus_Detailed (37).xlsx', cokeConfigFull))
        .rawRows;
      const { rows, errors } = normalizeClientRows(cokeConfigFull, rawRows);
      expect(errors.filter((e) => e.message.includes('Unknown status: Open'))).toHaveLength(0);
      expect(errors.length).toBeLessThan(20);
      expect(rows.length).toBeGreaterThan(30_000);
      expect(rows.every((r) => r.region === 'SOUTH')).toBe(true);
      expect(rows.every((r) => r.logged_at != null)).toBe(true);
      const ytdStart = new Date('2026-01-01');
      const inYtd = rows.filter((r) => r.logged_at! >= ytdStart).length;
      expect(inYtd).toBeGreaterThan(30_000);
    },
    120_000
  );

  it.skipIf(!hasCdms)(
    'reports mismatch when CDMS uploaded as Cadbury',
    async () => {
      const buf = readFileSync(cdmsPath);
      const result = await parseImportFile(buf, 'CDMS.xlsx', cadburyConfig);
      expect(result.sniffedSource).toBe('coke');
      expect(sourceMismatchMessage(result.sniffedSource, 'cadbury')).toMatch(/Coke CDMS/i);
    },
    30_000
  );

  it.skipIf(!hasVms)('reports mismatch when VMS csv uploaded as Coke', async () => {
    const buf = readFileSync(vmsCsvPath);
    const result = await parseImportFile(buf, 'cadbury.csv', cokeConfigFull);
    expect(result.sniffedSource).toBe('cadbury');
    expect(sourceMismatchMessage(result.sniffedSource, 'coke')).toMatch(/Cadbury VMS/i);
  });
});

describe('buildImportFilePath', () => {
  it('builds stable relative path for stored files', () => {
    const { storedFilePath } = buildImportFilePath('coke', 'batch-uuid', 'report.csv');
    expect(storedFilePath).toBe('coke/batch-uuid/report.csv');
  });
});

describe('batch file export', () => {
  it('rebuilds pipe-delimited csv from raw rows', async () => {
    const { rawRowsToCsvBuffer } = await import('@/modules/mis/client-import/services/batch-file');
    const buffer = rawRowsToCsvBuffer(
      [
        { '.TicketNumber': 'T1', VDate: '2026-01-01', Service_Provider: 'Western Refrigeration' },
        { '.TicketNumber': 'T2', VDate: '2026-01-02', Service_Provider: 'Probiz Solutions' },
      ],
      '|'
    );
    const text = buffer.toString('utf8');
    expect(text).toContain('.TicketNumber|VDate|Service_Provider');
    expect(text).toContain('T1|2026-01-01|Western Refrigeration');
  });

  it('rebuilds xlsx from raw rows', async () => {
    const { rawRowsToXlsxBuffer } = await import('@/modules/mis/client-import/services/batch-file');
    const buffer = rawRowsToXlsxBuffer([
      { 'Call No': '1001', 'Entity Name': 'MH' },
      { 'Call No': '1002', 'Entity Name': 'KA' },
    ]);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('loadSourceConfigByCode', () => {
  it('loads mapping queries sequentially on one pg client', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/modules/mis/client-import/services/config.ts'),
      'utf8'
    );
    const fnBody = source.match(
      /export async function loadSourceConfigByCode[\s\S]*?(?=\nexport async function)/
    )?.[0];
    expect(fnBody).toBeTruthy();
    expect(fnBody).not.toMatch(/Promise\.all/);
  });
});

describe('runMisClientUploadQueue', () => {
  it('uploads files sequentially and continues after partial failure', async () => {
    const { runMisClientUploadQueue } = await import('@/modules/mis/client-import/services/upload-client');
    const order: string[] = [];
    const fileA = new File(['a'], 'a.csv', { type: 'text/csv' });
    const fileB = new File(['b'], 'b.csv', { type: 'text/csv' });
    const fileC = new File(['c'], 'c.csv', { type: 'text/csv' });

    const results = await runMisClientUploadQueue({
      sourceCode: 'coke',
      files: [fileA, fileB, fileC],
      uploadFn: async ({ file, fileIndex, fileTotal }) => {
        order.push(file.name);
        expect(fileTotal).toBe(3);
        expect(fileIndex).toBe(order.length);
        if (file.name === 'b.csv') {
          throw new Error('simulated failure');
        }
        return { rowCount: 10, errorCount: 0 };
      },
    });

    expect(order).toEqual(['a.csv', 'b.csv', 'c.csv']);
    expect(results).toHaveLength(3);
    expect(results[0]?.data?.rowCount).toBe(10);
    expect(results[1]?.error).toMatch(/simulated failure/);
    expect(results[2]?.data?.rowCount).toBe(10);
  });

  it('forwards accessToken to uploadFn', async () => {
    const { runMisClientUploadQueue } = await import('@/modules/mis/client-import/services/upload-client');
    const file = new File(['x'], 'x.csv', { type: 'text/csv' });
    let seen: string | null | undefined;
    await runMisClientUploadQueue({
      sourceCode: 'cadbury',
      files: [file],
      accessToken: 'tok-abc',
      uploadFn: async ({ accessToken }) => {
        seen = accessToken;
        return { rowCount: 1 };
      },
    });
    expect(seen).toBe('tok-abc');
  });
});

describe('formatMisUploadProgressLabel', () => {
  it('includes file index when uploading multiple files', async () => {
    const { formatMisUploadProgressLabel } = await import('@/modules/mis/client-import/services/upload-client');
    const label = formatMisUploadProgressLabel({
      sent: 512_000,
      total: 1_024_000,
      chunkIndex: 2,
      chunkTotal: 4,
      phase: 'uploading',
      fileIndex: 2,
      fileTotal: 3,
      fileName: 'report.xlsx',
    });
    expect(label).toContain('File 2/3');
    expect(label).toContain('report.xlsx');
    expect(label).toContain('Uploading part 2/4');
  });
});

describe('isRegisterRowSolvedForMis', () => {
  it('counts tech-solve (bfastclose) as solved for CRM MIS totals', () => {
    expect(
      isRegisterRowSolvedForMis({
        bfastclose: 'True',
        bsolved: 'False',
        ncancelreason: 0,
        nengineer: '95',
      })
    ).toBe(true);
  });

  it('counts closed (bsolved) as solved', () => {
    expect(
      isRegisterRowSolvedForMis({
        bsolved: 'True',
        bfastclose: 'False',
        ncancelreason: 0,
      })
    ).toBe(true);
  });

  it('does not count assigned open calls as solved', () => {
    expect(
      isRegisterRowSolvedForMis({
        bsolved: 'False',
        bfastclose: 'False',
        ncancelreason: 0,
        nengineer: '95',
      })
    ).toBe(false);
  });
});
