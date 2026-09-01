import { describe, expect, it } from 'vitest';
import {
  CANCELLED_COLUMNS,
  cancelledAtFromHot,
  isCancelledHotRow,
} from './upsert-cancelled';
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
    item_code: null,
    serial: null,
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
    is_major: false,
    is_part_pending: false,
    branch_headcount: 0,
    logged_at: new Date('2026-01-15'),
    solved_at: null,
    edited_at: new Date('2026-08-22T10:00:00'),
    added_at: new Date('2026-01-15'),
    source_editedon: new Date('2026-08-22T10:00:00'),
    bsolved: false,
    bfastclose: false,
    bapproval: null,
    bm_approved_at: null,
    arcp_bm_approved_at: null,
    ncancelreason: 0,
    cancel_reason: null,
    cancelled_at: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe('CANCELLED_COLUMNS', () => {
  it('matches calls_cancelled schema (excl. synced_at)', () => {
    expect([...CANCELLED_COLUMNS]).toEqual([
      'vtrnno',
      'ncode',
      'ncancelreason',
      'cancelled_at',
      'logged_at',
      'call_type',
      'nofficeid',
      'office_under',
      'party_name',
      'branch_name',
      'franchisee_name',
      'region',
      'account',
      'item_name',
      'serial',
      'engineer_name',
      'complaint',
      'cancel_reason',
      'item_code',
      'franchisee_vendor_code',
    ]);
  });
});

describe('isCancelledHotRow', () => {
  it('treats a real ncancelreason as cancelled', () => {
    expect(isCancelledHotRow(hotRow({ ncancelreason: 10 }))).toBe(true);
  });

  it('excludes transfer (ncancelreason = 2) and none (0)', () => {
    expect(isCancelledHotRow(hotRow({ ncancelreason: 2 }))).toBe(false);
    expect(isCancelledHotRow(hotRow({ ncancelreason: 0 }))).toBe(false);
    expect(isCancelledHotRow(hotRow({ ncancelreason: null }))).toBe(false);
  });

  it('treats status_bucket cancelled as cancelled even if ncr is missing', () => {
    expect(
      isCancelledHotRow(hotRow({ status_bucket: 'cancelled', ncancelreason: 0 }))
    ).toBe(true);
  });
});

describe('cancelledAtFromHot', () => {
  it('uses last editedon as cancelled-on', () => {
    const edited = new Date('2026-08-22T14:30:00');
    expect(cancelledAtFromHot(hotRow({ edited_at: edited })).toISOString()).toBe(
      edited.toISOString()
    );
  });

  it('falls back to source_editedon then logged_at', () => {
    const source = new Date('2026-08-23T09:00:00');
    expect(
      cancelledAtFromHot(hotRow({ edited_at: null, source_editedon: source })).toISOString()
    ).toBe(source.toISOString());
    const logged = new Date('2026-01-15T00:00:00');
    expect(
      cancelledAtFromHot(
        hotRow({ edited_at: null, source_editedon: null, logged_at: logged })
      ).toISOString()
    ).toBe(logged.toISOString());
  });
});
