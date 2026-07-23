import { describe, expect, it } from 'vitest';
import {
  callRegisterDateSqlExpr,
  isCallRegisterAllTime,
  parseCallRegisterDateField,
  resolveCallRegisterDates,
} from './dates';

describe('call-register All Time date resolution', () => {
  it('treats empty query as All Time', () => {
    const allTime = resolveCallRegisterDates(new URLSearchParams(''));
    expect(isCallRegisterAllTime(allTime)).toBe(true);
    expect(allTime.dateField).toBe('imported');
  });

  it('keeps explicit date range as dated (not All Time)', () => {
    const month = resolveCallRegisterDates(
      new URLSearchParams('dateFrom=2026-07-01&dateTo=2026-07-20')
    );
    expect(isCallRegisterAllTime(month)).toBe(false);
    expect(month.dateFrom).toBe('2026-07-01');
    expect(month.dateTo).toBe('2026-07-20');
  });

  it('parses dateField billing vs imported', () => {
    expect(parseCallRegisterDateField('billing')).toBe('billing');
    expect(parseCallRegisterDateField('imported')).toBe('imported');
    expect(parseCallRegisterDateField(null)).toBe('imported');
    expect(
      resolveCallRegisterDates(new URLSearchParams('dateField=billing')).dateField
    ).toBe('billing');
  });

  it('builds SQL date expressions', () => {
    expect(callRegisterDateSqlExpr('imported', 'b')).toBe('b.daddedon');
    expect(callRegisterDateSqlExpr('billing', 'b')).toBe(
      'COALESCE(b.warranty_start, b.daddedon)'
    );
    expect(callRegisterDateSqlExpr('imported')).toBe('daddedon');
  });
});
