import { describe, expect, it } from 'vitest';
import { formatRegisterExportDate } from '@/lib/register/export-dates';

describe('formatRegisterExportDate', () => {
  it('formats Date objects as DD Mon YYYY', () => {
    const d = new Date('2026-06-24T14:16:10.000Z');
    expect(formatRegisterExportDate(d)).toMatch(/24 Jun 2026/);
  });

  it('formats ISO strings', () => {
    expect(formatRegisterExportDate('2026-02-15T10:00:00.000Z')).toMatch(/15 Feb 2026/);
  });

  it('returns empty for null', () => {
    expect(formatRegisterExportDate(null)).toBe('');
  });
});
