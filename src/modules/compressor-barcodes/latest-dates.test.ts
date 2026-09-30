import { describe, expect, it } from 'vitest';
import { callDatesSpanDays, latestDatesFromCalls } from './latest-dates';

describe('latestDatesFromCalls', () => {
  it('keeps call and solve maxima independent across visits', () => {
    const dates = latestDatesFromCalls([
      { call_date: '2026-08-01T00:00:00.000Z', solve_date: '2026-09-20T00:00:00.000Z' },
      { call_date: '2026-09-10T00:00:00.000Z', solve_date: '2026-09-12T00:00:00.000Z' },
    ]);
    expect(dates.latest_call_date).toBe('2026-09-10T00:00:00.000Z');
    expect(dates.earliest_call_date).toBe('2026-08-01T00:00:00.000Z');
    expect(dates.latest_solve_date).toBe('2026-09-20T00:00:00.000Z');
  });

  it('on Solved-Date period set, earliest call can be older than the period', () => {
    const inPeriodBySolve = [
      { call_date: '2026-07-15T00:00:00.000Z', solve_date: '2026-09-10T00:00:00.000Z' },
      { call_date: '2026-08-20T00:00:00.000Z', solve_date: '2026-09-25T00:00:00.000Z' },
    ];
    const dates = latestDatesFromCalls(inPeriodBySolve);
    expect(dates.earliest_call_date).toBe('2026-07-15T00:00:00.000Z');
    expect(dates.latest_call_date).toBe('2026-08-20T00:00:00.000Z');
    expect(dates.latest_solve_date).toBe('2026-09-25T00:00:00.000Z');
  });
});

describe('callDatesSpanDays', () => {
  it('is true when log dates cross days', () => {
    expect(
      callDatesSpanDays('2026-08-20T00:00:00.000Z', '2026-09-10T00:00:00.000Z')
    ).toBe(true);
    expect(
      callDatesSpanDays('2026-09-10T08:00:00.000Z', '2026-09-10T18:00:00.000Z')
    ).toBe(false);
  });
});
