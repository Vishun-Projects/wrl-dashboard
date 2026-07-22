import { describe, expect, it } from 'vitest';
import { isCallRegisterAllTime, resolveCallRegisterDates } from './dates';

describe('call-register All Time date resolution', () => {
  it('treats empty query as All Time', () => {
    const allTime = resolveCallRegisterDates(new URLSearchParams(''));
    expect(isCallRegisterAllTime(allTime)).toBe(true);
  });

  it('keeps explicit date range as dated (not All Time)', () => {
    const month = resolveCallRegisterDates(
      new URLSearchParams('dateFrom=2026-07-01&dateTo=2026-07-20')
    );
    expect(isCallRegisterAllTime(month)).toBe(false);
    expect(month.dateFrom).toBe('2026-07-01');
    expect(month.dateTo).toBe('2026-07-20');
  });
});
