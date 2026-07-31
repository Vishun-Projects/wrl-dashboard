import { describe, expect, it } from 'vitest';
import {
  buildDigestAccountDisplayRows,
  filterDigestKeyAccountRows,
  listDigestAvailableKeyAccounts,
  resolveDigestKeyAccountBodyRows,
  resolveDigestKeyAccountNames,
} from '@/features/mis-email/services/fetch-digest-accounts';
import type { AccountSummaryRow } from '@/features/report';

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
    const rows = resolveDigestKeyAccountBodyRows(crmAccounts, clientAccounts, [], {});
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to all accounts when explicit selection has no matches', () => {
    const rows = resolveDigestKeyAccountBodyRows(
      crmAccounts,
      clientAccounts,
      ['Unknown Account'],
      {}
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.map((row) => String(row.account))).toEqual(
      expect.arrayContaining(['Nestle', 'COKE'])
    );
  });

  it('supports per-zone account selection and excludes empty zones', () => {
    const rows = resolveDigestKeyAccountBodyRows(crmAccounts, clientAccounts, [], {
      NORTH: ['Nestle'],
      WEST: [],
    });
    expect(rows.map((row) => String(row.account))).toEqual(['Nestle']);
  });

  it('keeps the same account only in the zones where it was selected', () => {
    const multiZoneCrm: AccountSummaryRow[] = [
      ...crmAccounts,
      {
        ...crmAccounts[0],
        region: 'EAST ZONE',
        account: 'Nestle',
      },
      {
        ...crmAccounts[0],
        region: 'SOUTH ZONE',
        account: 'Nestle',
      },
    ];
    const rows = resolveDigestKeyAccountBodyRows(multiZoneCrm, [], [], {
      NORTH: ['Nestle'],
      EAST: [],
      SOUTH: [],
      WEST: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].region).toBe('NORTH ZONE');
    expect(rows[0].account).toBe('Nestle');
  });

  it('shows the same account in every zone where it was selected', () => {
    const multiZoneCrm: AccountSummaryRow[] = [
      { ...crmAccounts[0], region: 'NORTH ZONE', account: 'Nestle' },
      { ...crmAccounts[0], region: 'EAST ZONE', account: 'Nestle' },
      { ...crmAccounts[0], region: 'WEST ZONE', account: 'Nestle' },
      { ...crmAccounts[0], region: 'SOUTH ZONE', account: 'Nestle' },
    ];
    const rows = resolveDigestKeyAccountBodyRows(multiZoneCrm, [], [], {
      NORTH: ['Nestle'],
      EAST: ['Nestle'],
      WEST: [],
      SOUTH: [],
    });
    expect(rows.map((row) => `${row.region}:${row.account}`)).toEqual([
      'NORTH ZONE:Nestle',
      'EAST ZONE:Nestle',
    ]);
  });

  it('includes Cadbury/Coke client rows in selected zones and matches Mondelez/HCCB picks', () => {
    const clientOnly: AccountSummaryRow[] = [
      {
        ...clientAccounts[0],
        region: 'NORTH ZONE',
        account: 'CADBURY',
      },
      {
        ...clientAccounts[0],
        region: 'EAST ZONE',
        account: 'CADBURY',
      },
      {
        ...clientAccounts[0],
        region: 'SOUTH ZONE',
        account: 'COKE',
      },
      {
        ...clientAccounts[0],
        region: 'WEST ZONE',
        account: 'COKE',
      },
    ];
    const rows = resolveDigestKeyAccountBodyRows([], clientOnly, [], {
      NORTH: ['Mondelez'],
      EAST: ['CADBURY'],
      SOUTH: ['HCCB'],
      WEST: [],
    });
    expect(rows.map((row) => `${row.region}:${row.account}`)).toEqual([
      'NORTH ZONE:CADBURY',
      'EAST ZONE:CADBURY',
      'SOUTH ZONE:COKE',
    ]);
  });
});
