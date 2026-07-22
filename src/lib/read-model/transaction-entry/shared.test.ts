import { describe, expect, it } from 'vitest';
import { parseCrmDaddedon, monthChunks, yearChunks, periodDays } from './shared';

describe('transaction-entry shared helpers', () => {
  it('parses CRM daddedon dates', () => {
    const d = parseCrmDaddedon('11/06/2026 01:22:09');
    expect(d?.toISOString().startsWith('2026-06-11')).toBe(true);
    const d2 = parseCrmDaddedon('20/07/2026 11:03:02');
    expect(d2?.toISOString().startsWith('2026-07-20')).toBe(true);
  });

  it('chunks months and years', () => {
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
