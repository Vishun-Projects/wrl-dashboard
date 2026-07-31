import { describe, expect, it } from 'vitest';
import {
  callRegisterDateSqlExpr,
  isCallRegisterAllTime,
  parseCallRegisterDateField,
  resolveCallRegisterDates,
} from './dates';

describe('call-register dates', () => {
  it('defaults dateField to billing unless imported', () => {
    expect(parseCallRegisterDateField(null)).toBe('billing');
    expect(parseCallRegisterDateField(undefined)).toBe('billing');
    expect(parseCallRegisterDateField('billing')).toBe('billing');
    expect(parseCallRegisterDateField('imported')).toBe('imported');
    expect(parseCallRegisterDateField('other')).toBe('billing');
  });

  it('treats missing both bounds as all-time', () => {
    expect(isCallRegisterAllTime({})).toBe(true);
    expect(isCallRegisterAllTime({ dateFrom: undefined, dateTo: undefined })).toBe(true);
    expect(isCallRegisterAllTime({ dateFrom: '2026-01-01' })).toBe(false);
    expect(isCallRegisterAllTime({ dateTo: '2026-01-31' })).toBe(false);
    expect(isCallRegisterAllTime({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })).toBe(false);
  });

  it('does not invent month defaults when query omits dates (All Time)', () => {
    const resolved = resolveCallRegisterDates(new URLSearchParams());
    expect(resolved.dateFrom).toBeUndefined();
    expect(resolved.dateTo).toBeUndefined();
    expect(resolved.dateField).toBe('billing');
    expect(isCallRegisterAllTime(resolved)).toBe(true);
  });

  it('passes through explicit dateFrom/dateTo/dateField', () => {
    const q = new URLSearchParams({
      dateFrom: '2025-01-01',
      dateTo: '2025-01-31',
      dateField: 'imported',
    });
    expect(resolveCallRegisterDates(q)).toEqual({
      dateFrom: '2025-01-01',
      dateTo: '2025-01-31',
      dateField: 'imported',
    });
  });

  it('builds SQL expr for billing vs imported', () => {
    expect(callRegisterDateSqlExpr('billing')).toBe('COALESCE(warranty_start, daddedon)');
    expect(callRegisterDateSqlExpr('billing', 'b')).toBe(
      'COALESCE(b.warranty_start, b.daddedon)'
    );
    expect(callRegisterDateSqlExpr('imported')).toBe('daddedon');
    expect(callRegisterDateSqlExpr('imported', 'b')).toBe('b.daddedon');
  });
});
