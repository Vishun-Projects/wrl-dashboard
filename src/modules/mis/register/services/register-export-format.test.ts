import { describe, expect, it } from 'vitest';
import { formatExportDate } from '@/lib/utils/export-dates';
import { formatRegisterExportDate } from '@/modules/mis/register/services/register-export-format';

describe('formatExportDate', () => {
  it('formats Date objects as DD.MM.YYYY', () => {
    const d = new Date('2026-06-25T10:00:00.000Z');
    expect(formatExportDate(d)).toMatch(/^\d{2}\.\d{2}\.2026$/);
    expect(formatExportDate(d)).toBe('25.06.2026');
  });

  it('formats ISO date strings', () => {
    expect(formatExportDate('2026-06-25')).toBe('25.06.2026');
  });

  it('returns empty for nullish', () => {
    expect(formatExportDate(null)).toBe('');
    expect(formatExportDate(undefined)).toBe('');
  });
});

describe('formatRegisterExportDate', () => {
  it('matches formatExportDate', () => {
    expect(formatRegisterExportDate('2026-06-25')).toBe('25.06.2026');
  });
});
