import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolvePreYtdHistoricalRange } from './backfill-historical';

describe('resolvePreYtdHistoricalRange', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 2020-01-01 through day before current year start', () => {
    vi.stubEnv('SYNC_HISTORICAL_START_DATE', '');
    const range = resolvePreYtdHistoricalRange();
    expect(range).not.toBeNull();
    expect(range!.startDate).toBe('2020-01-01');
    expect(range!.endDate).toMatch(/^\d{4}-12-31$/);
  });

  it('honours SYNC_HISTORICAL_START_DATE', () => {
    vi.stubEnv('SYNC_HISTORICAL_START_DATE', '2018-06-01');
    const range = resolvePreYtdHistoricalRange();
    expect(range?.startDate).toBe('2018-06-01');
  });
});
