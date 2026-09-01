import { describe, expect, it } from 'vitest';
import { athenaIncrementalWindows, buildAthenaFetchSql } from './crm-fetch';

describe('athenaIncrementalWindows', () => {
  it('splits multi-day watermark into daily windows', () => {
    const watermark = new Date(2026, 7, 28, 10, 0, 0);
    const end = new Date(2026, 7, 31, 12, 0, 0);
    const windows = athenaIncrementalWindows(watermark, end);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.from.getTime()).toBeLessThanOrEqual(watermark.getTime());
    expect(windows.at(-1)!.toExclusive.getTime()).toBe(end.getTime());
  });

  it('returns empty when watermark is already at end', () => {
    const t = new Date(2026, 7, 31, 12, 0, 0);
    expect(athenaIncrementalWindows(t, t)).toEqual([]);
  });
});

describe('buildAthenaFetchSql', () => {
  it('adds upper bound for chunked watermark fetch', () => {
    const from = new Date(2026, 7, 29, 0, 0, 0);
    const to = new Date(2026, 7, 30, 0, 0, 0);
    const sql = buildAthenaFetchSql({ watermarkAddedon: from, watermarkToExclusive: to });
    expect(sql).toContain('>=');
    expect(sql).toContain('<');
  });
});
