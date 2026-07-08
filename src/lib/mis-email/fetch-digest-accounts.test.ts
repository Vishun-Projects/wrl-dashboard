import { describe, expect, it } from 'vitest';
import {
  buildDigestAccountDisplayRows,
  filterDigestKeyAccountRows,
  listDigestAvailableKeyAccounts,
  resolveDigestKeyAccountBodyRows,
  resolveDigestKeyAccountNames,
} from '@/lib/mis-email/fetch-digest-accounts';
import type { AccountSummaryRow } from '@/lib/report/summary-derive';

const crmAccounts: AccountSummaryRow[] = [
  {
    region: 'NORTH ZONE',
    account: 'Nestle',
    population: 1,
    total_calls: 10,
    total_solved: 8,
    cancelled_calls: 0,
    open_calls: 2,
    age_2: 1,
    age_3: 0,
    age_7: 1,
    age_15: 0,
    part_pending: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 1,
    headcount: 1,
    total_tech_solved: 0,
  },
];

const clientAccounts: AccountSummaryRow[] = [
  {
    region: 'WEST ZONE',
    account: 'COKE',
    population: 0,
    total_calls: 20,
    total_solved: 15,
    cancelled_calls: 0,
    open_calls: 5,
    age_2: 2,
    age_3: 1,
    age_7: 1,
    age_15: 1,
    part_pending: 0,
    deployment_total: 0,
    deployment_done: 0,
    installation_total: 0,
    installation_done: 0,
    active_eng: 2,
    headcount: 0,
    total_tech_solved: 0,
  },
];

describe('buildDigestAccountDisplayRows', () => {
  it('merges CRM and client-only account rows', () => {
    const rows = buildDigestAccountDisplayRows(crmAccounts, clientAccounts);
    expect(rows.map((r) => String(r.account))).toEqual(expect.arrayContaining(['Nestle', 'COKE']));
    expect(rows.length).toBe(2);
  });
});

describe('listDigestAvailableKeyAccounts', () => {
  it('returns sorted unique account names', () => {
    expect(listDigestAvailableKeyAccounts(crmAccounts, clientAccounts)).toEqual([
      'COKE',
      'Nestle',
    ]);
  });
});

describe('filterDigestKeyAccountRows', () => {
  it('filters selected accounts case-insensitively', () => {
    const filtered = filterDigestKeyAccountRows(crmAccounts, clientAccounts, ['coke']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].account).toBe('COKE');
  });

  it('returns empty when no accounts selected', () => {
    expect(filterDigestKeyAccountRows(crmAccounts, clientAccounts, [])).toEqual([]);
  });
});

describe('resolveDigestKeyAccountNames', () => {
  it('uses all accounts when selection is empty', () => {
    const names = resolveDigestKeyAccountNames(crmAccounts, clientAccounts, []);
    expect(names).toEqual(expect.arrayContaining(['Nestle', 'COKE']));
  });

  it('respects explicit selection', () => {
    expect(resolveDigestKeyAccountNames(crmAccounts, clientAccounts, ['Nestle'])).toEqual(['Nestle']);
  });
});

describe('resolveDigestKeyAccountBodyRows', () => {
  it('returns merged rows for all accounts when selection empty', () => {
    const rows = resolveDigestKeyAccountBodyRows(crmAccounts, clientAccounts, []);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to all accounts when explicit selection has no matches', () => {
    const rows = resolveDigestKeyAccountBodyRows(crmAccounts, clientAccounts, ['Unknown Account']);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => String(row.account))).toEqual(
      expect.arrayContaining(['Nestle', 'COKE'])
    );
  });
});
