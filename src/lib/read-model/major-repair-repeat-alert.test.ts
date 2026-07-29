import { describe, expect, it } from 'vitest';
import {
  buildAlertEmailHtml,
  buildAlertEmailText,
  filterMajorRepairAlertCandidates,
  hasTargetRepair,
  majorRepairRepeatDateWindow,
  meetsRepeatThreshold,
  repairDoneFromCrmFlags,
} from './major-repair-repeat-alert';
import {
  normalizeBranchKey,
  resolveAlertRecipients,
} from './major-repair-repeat-recipients';
import type { HotRow } from './types';

function hotRow(overrides: Partial<HotRow> = {}): HotRow {
  return {
    ncode: 1,
    vtrnno: '26F01029',
    vcclid: null,
    nofficeid: 1,
    nengineer: null,
    office_under: null,
    franchisee_code: null,
    party_name: 'Test',
    branch_name: 'PUNE',
    franchisee_name: null,
    pincode: null,
    city: null,
    state: null,
    region: 'WEST ZONE',
    account: 'Pepsi',
    item_name: null,
    serial: 'ABC123',
    wco: null,
    engineer_name: null,
    call_type: 'BREAKDOWN',
    complaint: null,
    status_label: 'Assigned',
    status_bucket: 'assigned',
    solve_remarks: null,
    contact_person: null,
    phone: null,
    address: null,
    has_visit: false,
    is_major: true,
    is_part_pending: false,
    branch_headcount: 0,
    logged_at: new Date('2026-06-01'),
    solved_at: null,
    edited_at: new Date('2026-06-26'),
    added_at: new Date('2026-06-01'),
    source_editedon: new Date('2026-06-26'),
    bsolved: false,
    bfastclose: false,
    bapproval: null,
    bm_approved_at: null,
    arcp_bm_approved_at: null,
    ncancelreason: 0,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe('major-repair-repeat-alert', () => {
  it('hasTargetRepair matches motor, compressor, and gas', () => {
    expect(hasTargetRepair('Motor Replaced')).toBe(true);
    expect(hasTargetRepair('Compressor Replaced; Gas Charging Done')).toBe(true);
    expect(hasTargetRepair('Filter Cleaned')).toBe(false);
    expect(hasTargetRepair('')).toBe(false);
  });

  it('repairDoneFromCrmFlags maps CRM batch flags', () => {
    expect(
      repairDoneFromCrmFlags({ has_motor: 1, has_compressor: 0, has_gas: 1 })
    ).toBe('Motor Replaced; Gas Charging Done');
  });

  it('meetsRepeatThreshold requires count >= minCount (default 3)', () => {
    expect(meetsRepeatThreshold(2)).toBe(false);
    expect(meetsRepeatThreshold(3)).toBe(true);
    expect(meetsRepeatThreshold(4)).toBe(true);
    expect(meetsRepeatThreshold(2, 3)).toBe(false);
  });

  it('majorRepairRepeatDateWindow spans months * 30 days', () => {
    const { startDate, endDate } = majorRepairRepeatDateWindow(3, new Date('2026-07-21'));
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(startDate < endDate).toBe(true);
  });

  it('filterMajorRepairAlertCandidates keeps major rows with target repairs only', () => {
    const rows = [
      hotRow({ vtrnno: '26F00001', is_major: true, serial: 'SER1' }),
      hotRow({ vtrnno: '26F00002', is_major: false, serial: 'SER2' }),
      hotRow({ vtrnno: '26F00003', is_major: true, serial: '0' }),
      hotRow({ vtrnno: '26F00004', is_major: true, serial: 'SER4' }),
    ];
    const repairDoneByTrn = new Map<string, string>([
      ['26F00001', 'Motor Replaced'],
      ['26F00004', 'Filter Cleaned'],
    ]);
    const candidates = filterMajorRepairAlertCandidates(rows, repairDoneByTrn);
    expect(candidates.map((c) => c.vtrnno)).toEqual(['26F00001']);
    expect(candidates[0]?.repair_done).toBe('Motor Replaced');
  });

  it('buildAlertEmailHtml features trigger call ID and omits dashboard link', () => {
    const html = buildAlertEmailHtml({
      serial: 'SER99',
      triggerTrn: '26F09999',
      branchName: 'PUNE',
      callCount: 3,
      months: 3,
      startDate: '2026-04-22',
      endDate: '2026-07-21',
      details: [
        {
          vtrnno: '26F09999',
          callsdtrndate: '2026-07-21',
          PartyName: 'Acme',
          repair_done: 'Motor Replaced',
          callstatus: 'Open',
          vcomplaint: 'Not cooling',
        },
      ],
    });
    expect(html).toContain('26F09999');
    expect(html).toContain('Triggering open call ID');
    expect(html).toContain('SER99');
    expect(html).toContain('PUNE');
    expect(html).toContain('SLA notification');
    expect(html).not.toContain('Open WRL dashboard');
    expect(html).not.toContain('href=');
  });

  it('buildAlertEmailText leads with triggering open call ID', () => {
    const text = buildAlertEmailText({
      serial: 'SER99',
      triggerTrn: '26F09999',
      branchName: 'PUNE',
      callCount: 3,
      months: 3,
      startDate: '2026-04-22',
      endDate: '2026-07-21',
    });
    expect(text).toContain('Triggering open call ID: 26F09999');
    expect(text).not.toContain('dashboard');
  });
});

describe('major-repair-repeat-recipients', () => {
  it('normalizeBranchKey trims and uppercases', () => {
    expect(normalizeBranchKey('  pune  ')).toBe('PUNE');
    expect(normalizeBranchKey('Mumbai West')).toBe('MUMBAI WEST');
  });

  it('resolveAlertRecipients prefers branch To and keeps HQ on Cc', () => {
    expect(
      resolveAlertRecipients({
        branchEmails: ['bm@example.com', ' BM@example.com '],
        hqTo: 'sunil.sawant@westernequipments.com',
        hqCc: 'vishnu.vishwakarma@westernequipments.com',
      })
    ).toEqual({
      to: ['bm@example.com'],
      cc: [
        'sunil.sawant@westernequipments.com',
        'vishnu.vishwakarma@westernequipments.com',
      ],
    });
  });

  it('resolveAlertRecipients falls back to HQ To when branch list empty', () => {
    expect(
      resolveAlertRecipients({
        branchEmails: [],
        hqTo: 'sunil.sawant@westernequipments.com',
        hqCc: 'vishnu.vishwakarma@westernequipments.com',
      })
    ).toEqual({
      to: ['sunil.sawant@westernequipments.com'],
      cc: ['vishnu.vishwakarma@westernequipments.com'],
    });
  });
});
