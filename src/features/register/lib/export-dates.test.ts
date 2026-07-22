import { describe, expect, it } from 'vitest';
import { formatExportDate } from '@/lib/utils/export-dates';
import { formatRegisterExportDate } from '@/features/register/lib/export-dates';

describe('formatExportDate', () => {
  it('formats Date objects as DD.MM.YYYY', () => {
    const d = new Date('2026-06-25T10:00:00.000Z');
    expect(formatExportDate(d)).toMatch(/^\d{2}\.\d{2}\.2026$/);
    expect(formatExportDate(d)).toBe('25.06.2026');
  });

  it('formats ISO strings', () => {
    expect(formatExportDate('2026-02-15T10:00:00.000Z')).toBe('15.02.2026');
  });

  it('normalizes slash dates to dots', () => {
    expect(formatExportDate('15/02/2026')).toBe('15.02.2026');
  });

  it('returns empty for null', () => {
    expect(formatExportDate(null)).toBe('');
  });
});

describe('formatRegisterExportDate', () => {
  it('aliases formatExportDate', () => {
    expect(formatRegisterExportDate('2026-06-25')).toBe('25.06.2026');
  });
});
