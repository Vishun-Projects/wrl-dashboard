import { describe, expect, it } from 'vitest';
import { shouldReplaceHotFromCrm } from './apply-crm-delta';
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
    cancel_reason: null,
    cancelled_at: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe('shouldReplaceHotFromCrm', () => {
  it('replaces when hot row is missing', () => {
    const incoming = hotRow({ status_bucket: 'solved', status_label: 'Closed' });
    expect(shouldReplaceHotFromCrm(undefined, incoming)).toBe(true);
  });

  it('replaces when CRM editedon is newer (full row upsert)', () => {
    const existing = hotRow({ status_bucket: 'assigned', source_editedon: new Date('2026-06-26') });
    const incoming = hotRow({
      status_bucket: 'solved',
      status_label: 'Closed',
      source_editedon: new Date('2026-06-30'),
    });
    expect(shouldReplaceHotFromCrm(existing, incoming)).toBe(true);
  });

  it('replaces when editedon matches (CRM is source of truth)', () => {
    const ts = new Date('2026-06-26');
    const existing = hotRow({ status_bucket: 'assigned', source_editedon: ts });
    const incoming = hotRow({ status_bucket: 'solved', source_editedon: ts });
    expect(shouldReplaceHotFromCrm(existing, incoming)).toBe(true);
  });

  it('skips strictly older CRM snapshot from overlap window when content matches', () => {
    const existing = hotRow({ source_editedon: new Date('2026-06-30') });
    const incoming = hotRow({ source_editedon: new Date('2026-06-26') });
    expect(shouldReplaceHotFromCrm(existing, incoming)).toBe(false);
  });

  it('replaces older CRM stamp when status differs (CRM is source of truth)', () => {
    const existing = hotRow({
      status_bucket: 'assigned',
      source_editedon: new Date('2026-06-30'),
    });
    const incoming = hotRow({
      status_bucket: 'cancelled',
      ncancelreason: 9,
      source_editedon: new Date('2026-06-26'),
    });
    expect(shouldReplaceHotFromCrm(existing, incoming)).toBe(true);
  });

  it('replaces older CRM stamp when is_major differs', () => {
    const existing = hotRow({
      is_major: false,
      source_editedon: new Date('2026-06-30'),
    });
    const incoming = hotRow({
      is_major: true,
      source_editedon: new Date('2026-06-26'),
    });
    expect(shouldReplaceHotFromCrm(existing, incoming)).toBe(true);
  });
});
