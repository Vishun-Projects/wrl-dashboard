import { describe, expect, it } from 'vitest';
import { istDayEndIso, istDayStartIso, monthStartIst } from '@/lib/dates/local-date';

describe('IST report day bounds', () => {
  it('pins Call Register / dashboard windows to +05:30', () => {
    expect(istDayStartIso('2026-11-01')).toBe('2026-11-01T00:00:00+05:30');
    expect(istDayEndIso('2026-11-02')).toBe('2026-11-02T23:59:59.999+05:30');
  });

  it('monthStartIst keeps YYYY-MM-01', () => {
    expect(monthStartIst('2026-11-02')).toBe('2026-11-01');
  });
});
