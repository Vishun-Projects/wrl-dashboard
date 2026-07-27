import { describe, expect, it } from 'vitest';
import {
  parseCrmDaddedon,
  monthChunks,
  weekChunks,
  yearChunks,
  periodDays,
  TRANSACTION_ENTRY_PROCESSED_SQL,
} from './shared';

describe('transaction-entry shared helpers', () => {
  it('parses CRM dd/mm/yyyy dates (daddedon / WarrantyStartDate)', () => {
    const d = parseCrmDaddedon('11/06/2026 01:22:09');
    expect(d?.toISOString().startsWith('2026-06-11')).toBe(true);
    const d2 = parseCrmDaddedon('14/11/2025 00:00:00');
    expect(d2?.toISOString().startsWith('2025-11-14')).toBe(true);
  });

  it('returns null for empty or unparsable daddedon', () => {
    expect(parseCrmDaddedon(null)).toBeNull();
    expect(parseCrmDaddedon(undefined)).toBeNull();
    expect(parseCrmDaddedon('')).toBeNull();
    expect(parseCrmDaddedon('   ')).toBeNull();
    expect(parseCrmDaddedon('not-a-date')).toBeNull();
    expect(parseCrmDaddedon('2026-06-11')).toBeNull();
  });

  it('requires PROCESSED = Y for Deployment Completion billings', () => {
    expect(TRANSACTION_ENTRY_PROCESSED_SQL).toMatch(/PROCESSED/);
    expect(TRANSACTION_ENTRY_PROCESSED_SQL).toMatch(/=\s*'Y'/);
  });

  it('chunks weeks, months and years', () => {
    const weeks = weekChunks('2026-01-01', '2026-01-20');
    expect(weeks).toEqual([
      { from: '2026-01-01', to: '2026-01-07' },
      { from: '2026-01-08', to: '2026-01-14' },
      { from: '2026-01-15', to: '2026-01-20' },
    ]);

    const months = monthChunks('2026-01-15', '2026-03-10');
    expect(months).toHaveLength(3);
    expect(months[0]?.from).toBe('2026-01-15');
    expect(months[2]?.to).toBe('2026-03-10');

    const years = yearChunks('2024-06-01', '2026-03-10');
    expect(years).toHaveLength(3);
    expect(years[0]?.from).toBe('2024-06-01');
    expect(years[2]?.to).toBe('2026-03-10');
  });

  it('counts period days inclusively', () => {
    expect(periodDays('2024-01-01', '2024-01-07')).toBe(7);
  });
});
