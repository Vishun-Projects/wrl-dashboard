import { describe, expect, it } from 'vitest';
import { diffHotRow } from '@/lib/read-model/audit/compare-hot';
import type { HotRow } from '@/lib/read-model/types';

function hot(overrides: Partial<HotRow> = {}): HotRow {
  return {
    ncode: 736,
    vtrnno: '26F01029',
    vcclid: null,
    nofficeid: 1175,
    nengineer: null,
    office_under: 100,
    franchisee_code: '123',
    party_name: 'Acme',
    branch_name: 'PUNE BRANCH',
    franchisee_name: 'FRANCHISEE',
    pincode: '411001',
    city: 'Pune',
    state: 'Maharashtra',
    region: 'WEST',
    account: 'PEPSI',
    item_name: 'Cooler',
    item_code: null,
    serial: 'SN1',
    wco: null,
    engineer_name: 'Tech A',
    call_type: 'BREAKDOWN',
    complaint: 'Not cooling',
    status_label: 'Assigned',
    status_bucket: 'assigned',
    solve_remarks: null,
    contact_person: 'John',
    phone: '9999999999',
    address: 'Main St',
    has_visit: false,
    is_major: false,
    is_part_pending: false,
    branch_headcount: 5,
    logged_at: new Date('2026-06-01T09:14:26'),
    solved_at: null,
    edited_at: new Date('2026-06-01T10:04:53'),
    added_at: new Date('2026-06-01T10:04:53'),
    source_editedon: new Date('2026-06-01T10:04:53'),
    bsolved: false,
    bfastclose: false,
    bapproval: null,
    bm_approved_at: null,
    arcp_bm_approved_at: null,
    ncancelreason: 0,
    cancel_reason: null,
    cancelled_at: null,
    lat: 18.5204,
    lng: 73.8567,
    ...overrides,
  };
}

describe('diffHotRow', () => {
  it('returns no mismatches for identical rows', () => {
    const row = hot();
    expect(diffHotRow(row, { ...row })).toEqual([]);
  });

  it('detects status_bucket mismatch', () => {
    const mismatches = diffHotRow(hot(), hot({ status_bucket: 'cancelled' }));
    expect(mismatches.some((m) => m.column === 'status_bucket')).toBe(true);
  });

  it('normalizes region/account case', () => {
    const mismatches = diffHotRow(hot({ region: 'west' }), hot({ region: 'WEST' }));
    expect(mismatches.filter((m) => m.column === 'region')).toEqual([]);
  });

  it('compares dates by epoch ms', () => {
    const a = hot({ logged_at: new Date('2026-06-01T09:14:26.000Z') });
    const b = hot({ logged_at: new Date('2026-06-01T09:14:26.000Z') });
    expect(diffHotRow(a, b)).toEqual([]);
  });

  it('compares lat/lng to 5 decimal places', () => {
    const mismatches = diffHotRow(
      hot({ lat: 18.52041, lng: 73.85671 }),
      hot({ lat: 18.520409999, lng: 73.856709999 })
    );
    expect(mismatches.filter((m) => m.column === 'lat' || m.column === 'lng')).toEqual([]);
  });

  it('detects boolean drift', () => {
    const mismatches = diffHotRow(hot({ bfastclose: false }), hot({ bfastclose: true }));
    expect(mismatches).toEqual([
      { column: 'bfastclose', hot_value: false, expected_value: true },
    ]);
  });

  it('detects bigint-like office id differences', () => {
    const mismatches = diffHotRow(hot({ nofficeid: 1175 }), hot({ nofficeid: 1176 }));
    expect(mismatches).toEqual([
      { column: 'nofficeid', hot_value: 1175, expected_value: 1176 },
    ]);
  });
});
