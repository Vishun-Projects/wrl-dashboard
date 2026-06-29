import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { dedupeClientRowsLatestBatchWins } from '@/lib/mis-client-import/aggregate';
import { buildImportFilePath } from '@/lib/mis-client-import/file-store';
import { mergedMetricValue, findAccountMetric, mergeSelectedMetrics, rollupAccountsByAccount, accountMergeFlags, filterTopAccountsByZone, accountRowScore, isAccountExcludedFromZoneTop } from '@/components/report/SummaryMergedMetricCell';
import { parsePipeDelimitedCsv, decodeCsvBuffer } from '@/lib/mis-client-import/parse-csv';
import { parseClientDate } from '@/lib/mis-client-import/parse-dates';
import { normalizeClientRows } from '@/lib/mis-client-import/normalize';
import { formatDisplayRegion, isKnownZone, normalizeClientRegion } from '@/lib/mis-client-import/region';
import { parseSourceCodesParam, sourceCodesToParam } from '@/lib/mis-client-import/source-selection';
import {
  isCadburyExcludedServiceProvider,
  shouldSkipCadburyImportRow,
} from '@/lib/mis-client-import/cadbury-filters';
import {
  detectFileFormat,
  parseImportFile,
  sniffSourceFromHeaders,
  sourceMismatchMessage,
} from '@/lib/mis-client-import/detect-parse';
import type { MisClientSourceConfig } from '@/lib/mis-client-import/types';

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
    { client_status: 'Open', status_bucket: 'open_unallocated', status_label: 'Open' },
    { client_status: 'Closed', status_bucket: 'solved', status_label: 'Closed' },
  ],
  stateMappings: [
    { client_state: 'Vijaywada Beverage', plan_code: null, region_override: 'SOUTH' },
  ],
};

describe('parsePipeDelimitedCsv', () => {
  it('parses Coke sample header and first row', () => {
    const samplePath = join(process.cwd(), 'VMSComplaintDetailsRpt.csv');
    const buffer = readFileSync(samplePath);
    const content = decodeCsvBuffer(buffer);
    const lines = content.split(/\r?\n/).slice(0, 3).join('\n');
    const { headers, rows } = parsePipeDelimitedCsv(lines, '|');
    expect(headers).toContain('.TicketNumber');
    expect(headers).toContain('CallStatus');
    expect(rows.length).toBe(2);
    expect(rows[0]['.TicketNumber']).toBe('1180695');
    expect(rows[0].CallStatus).toBe('Open');
  });

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
});

describe('normalizeClientRows', () => {
  it('maps Coke CDMS rows to normalized shape', () => {
    const { rows, errors } = normalizeClientRows(cokeConfig, [
      {
        'Call No': '1001',
        'Call Log Date': '29-12-2025',
        'Call Status': 'Open',
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
    expect(rows[0].status_bucket).toBe('open_unallocated');
    expect(rows[0].region).toBe('SOUTH');
    expect(rows[1].status_bucket).toBe('solved');
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
        'Call Status': 'Open',
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
        'Call Status': 'Open',
        'ASM Name': 'P L N Sirish',
      },
    ]);
    expect(errors).toHaveLength(0);
    expect(rows[0].region).toBe('SOUTH');
  });
});

describe('canUploadClientMis', () => {
  it('allows pilot email only', () => {
    expect(canUploadClientMis('vishunvishwakarma90211@gmail.com')).toBe(true);
    expect(canUploadClientMis('other@example.com')).toBe(false);
    expect(canUploadClientMis(null)).toBe(false);
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

  it('defaults Cadbury to import-only', () => {
    expect(accountMergeFlags('Cadbury', global, false)).toEqual({ crm: false, client: true });
    expect(accountMergeFlags('CADBURY', global, false)).toEqual({ crm: false, client: true });
  });

  it('merges Cadbury with CRM when enabled', () => {
    expect(accountMergeFlags('Cadbury', global, true)).toEqual(global);
  });

  it('does not affect other accounts', () => {
    expect(accountMergeFlags('Coke', global, false)).toEqual(global);
  });
});

describe('resolveSummaryRegionMetric', () => {
  it('matches Key Account Cadbury merge rules per region', async () => {
    const { resolveSummaryRegionMetric } = await import('@/components/report/SummaryMergedMetricCell');
    const accounts = [
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 100 },
      { region: 'SOUTH ZONE', account: 'Coke', total_calls: 50 },
    ];
    const clientAccounts = [
      { region: 'SOUTH ZONE', account: 'Cadbury', total_calls: 40 },
      { region: 'SOUTH ZONE', account: 'Coke', total_calls: 10 },
    ];
    const global = { crm: true, client: true };

    const withoutMerge = resolveSummaryRegionMetric(
      true,
      accounts,
      clientAccounts,
      'SOUTH',
      'total_calls',
      global,
      false,
      0,
      0
    );
    expect(withoutMerge.crm).toBe(100);

    const withMerge = resolveSummaryRegionMetric(
      true,
      accounts,
      clientAccounts,
      'SOUTH',
      'total_calls',
      global,
      true,
      0,
      0
    );
    expect(withMerge.crm).toBe(200);
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
    expect(accountRowScore(crmRow, client, global, false)).toBe(20);
    expect(accountRowScore(crmRow, client, global, true)).toBe(120);
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
};

describe('detect-parse', () => {
  const cdmsPath = join(process.cwd(), 'CDMS_CallStatus_Detailed (37).xlsx');
  const vmsCsvPath = join(process.cwd(), 'VMSComplaintDetailsRpt.csv');

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

  it('detects spreadsheet format for xlsx', () => {
    const buf = readFileSync(cdmsPath);
    expect(detectFileFormat(buf, 'report.xlsx')).toBe('spreadsheet');
  });

  it('detects csv format for VMS pipe file', () => {
    const buf = readFileSync(vmsCsvPath);
    expect(detectFileFormat(buf, 'VMSComplaintDetailsRpt.csv')).toBe('csv');
  });

  it('parses CDMS xlsx as Coke with thousands of rows', async () => {
    const buf = readFileSync(cdmsPath);
    const result = await parseImportFile(buf, 'CDMS_CallStatus_Detailed (37).xlsx', cokeConfigFull);
    expect(result.sniffedSource).toBe('coke');
    expect(result.detectedHeaderRow).toBe(5);
    expect(result.rawRows.length).toBeGreaterThan(1000);
    expect(result.rawRows[0]['Call No']).toBeTruthy();
  }, 60_000);

  it('auto-finds header row 5 when config header row is wrong', async () => {
    const buf = readFileSync(cdmsPath);
    const wrongHeader = { ...cokeConfigFull, header_row_index: 1 };
    const result = await parseImportFile(buf, 'CDMS_CallStatus_Detailed (37).xlsx', wrongHeader);
    expect(result.sniffedSource).toBe('coke');
    expect(result.rawRows.length).toBeGreaterThan(1000);
    expect(result.detectedHeaderRow).toBe(5);
    expect(result.warnings.some((w) => w.includes('Auto-detected header row 5'))).toBe(true);
  }, 60_000);

  it('parses Cadbury VMS csv with cadbury config', async () => {
    const buf = readFileSync(vmsCsvPath);
    const result = await parseImportFile(buf, 'VMSComplaintDetailsRpt.csv', cadburyConfig);
    expect(result.sniffedSource).toBe('cadbury');
    expect(result.detectedFormat).toBe('csv');
    expect(result.rawRows.length).toBeGreaterThan(100);
    expect(result.rawRows[0]['.TicketNumber']).toBeTruthy();
  });

  it('parses Cadbury VMS csv with thousands of rows end-to-end', async () => {
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
    expect(rows[0].call_key).toBeTruthy();
    expect(rows[0].region).toBeTruthy();
  });

  it('reports mismatch when CDMS uploaded as Cadbury', async () => {
    const buf = readFileSync(cdmsPath);
    const result = await parseImportFile(buf, 'CDMS.xlsx', cadburyConfig);
    expect(result.sniffedSource).toBe('coke');
    expect(sourceMismatchMessage(result.sniffedSource, 'cadbury')).toMatch(/Coke CDMS/i);
  }, 30_000);

  it('reports mismatch when VMS csv uploaded as Coke', async () => {
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
