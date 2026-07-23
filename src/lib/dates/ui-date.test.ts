import { describe, expect, it } from 'vitest';
import { formatUiDate, formatUiDateTime } from './ui-date';

describe('formatUiDate', () => {
  it('formats ISO date-only as dd/mm/yyyy', () => {
    expect(formatUiDate('2025-11-14')).toBe('14/11/2025');
  });

  it('formats CRM slash datetime as date only', () => {
    expect(formatUiDate('14/11/2025 00:00:00')).toBe('14/11/2025');
    expect(formatUiDate('11/06/2026 01:22:09')).toBe('11/06/2026');
  });

  it('formats Date via Asia/Kolkata calendar day', () => {
    expect(formatUiDate(new Date('2026-03-15T10:00:00Z'))).toBe('15/03/2026');
  });

  it('returns empty for nullish / blank / invalid', () => {
    expect(formatUiDate(null)).toBe('');
    expect(formatUiDate('')).toBe('');
    expect(formatUiDate('-')).toBe('');
    expect(formatUiDate('not-a-date')).toBe('');
  });
});

describe('formatUiDateTime', () => {
  it('keeps CRM time when present', () => {
    expect(formatUiDateTime('14/11/2025 11:03:02')).toBe('14/11/2025 11:03');
  });

  it('formats ISO instant with time in Asia/Kolkata', () => {
    // 10:00 UTC → 15:30 IST
    expect(formatUiDateTime(new Date('2026-03-15T10:00:00Z'))).toBe('15/03/2026 15:30');
    expect(formatUiDateTime('2026-03-15T10:00:00.000Z')).toBe('15/03/2026 15:30');
  });

  it('date-only string stays date-only (no fake midnight)', () => {
    expect(formatUiDateTime('2026-04-01')).toBe('01/04/2026');
  });

  it('returns empty for nullish', () => {
    expect(formatUiDateTime(null)).toBe('');
    expect(formatUiDateTime(undefined)).toBe('');
  });
});
