import { describe, expect, it } from 'vitest';
import { hotRowNeedsCrmRefresh } from './pipeline-reconcile';
import type { HotRow } from './types';

function hot(overrides: Partial<HotRow> = {}): HotRow {
  return {
    ncode: 1,
    vtrnno: '26F01029',
    vcclid: null,
    nofficeid: 1,
    nengineer: null,
    office_under: null,
    franchisee_code: null,
    party_name: null,
    branch_name: null,
    franchisee_name: null,
    pincode: null,
    city: null,
    state: null,
    region: 'WEST',
    account: 'Pepsi',
    item_name: null,
    serial: null,
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
    edited_at: null,
    added_at: new Date('2026-06-01'),
    source_editedon: null,
    bsolved: false,
    bfastclose: false,
    bapproval: null,
    bm_approved_at: null,
    ncancelreason: 0,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe('hotRowNeedsCrmRefresh', () => {
  it('detects cancellation drift (assigned hot vs cancelled CRM)', () => {
    const needs = hotRowNeedsCrmRefresh(hot(), {
      vtrnno: '26F01029',
      ncode: '736',
      nofficeid: '1175',
      ncancelreason: '9',
      bsolved: '0',
      bfastclose: '0',
      editedon: '26/06/2026 17:04:58',
      addedon: '01/06/2026 10:04:53',
      dtrndate: '01/06/2026 09:14:26',
      officename: '1175 - PUNE BRANCH',
      franchisee_name: 'SHREE CHINTAMANI REFRIGERATION',
      franchisee_code: '123',
      region: 'WEST ZONE',
      account: 'Pepsi',
    });
    expect(needs).toBe(true);
  });

  it('detects newer CRM editedon even when status fields look aligned', () => {
    const needs = hotRowNeedsCrmRefresh(
      hot({ source_editedon: new Date('2026-06-01') }),
      {
        vtrnno: '26F01029',
        ncode: '736',
        nofficeid: '1175',
        ncancelreason: '0',
        bsolved: '0',
        bfastclose: '0',
        editedon: '30/06/2026 17:30:00',
        addedon: '01/06/2026 10:04:53',
        dtrndate: '01/06/2026 09:14:26',
        region: 'WEST ZONE',
        account: 'Pepsi',
      }
    );
    expect(needs).toBe(true);
  });
});
