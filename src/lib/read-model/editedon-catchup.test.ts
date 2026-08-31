import { describe, expect, it } from 'vitest';
import { recentEditedonDays, resolveEditedonCatchupDays } from './editedon-catchup';

describe('recentEditedonDays', () => {
  it('returns inclusive trailing calendar days ending at endDay', () => {
    expect(recentEditedonDays('2026-07-20', 2)).toEqual(['2026-07-19', '2026-07-20']);
    expect(recentEditedonDays('2026-07-20', 1)).toEqual(['2026-07-20']);
    expect(recentEditedonDays('2026-07-20', 0)).toEqual([]);
  });
});

describe('resolveEditedonCatchupDays', () => {
  it('resumes after cursor and always includes recent trailing days', () => {
    const { days, resumedFrom } = resolveEditedonCatchupDays(
      '2026-01-01',
      '2026-08-30',
      '2026-02-07',
      { resume: true, recentCount: 2 }
    );
    expect(resumedFrom).toBe('2026-02-08');
    expect(days).toContain('2026-08-29');
    expect(days).toContain('2026-08-30');
    expect(days).not.toContain('2026-01-01');
    expect(days).not.toContain('2026-02-07');
    expect(days[0]).toBe('2026-02-08');
  });

  it('replays full range when resume is off', () => {
    const { days, resumedFrom } = resolveEditedonCatchupDays(
      '2026-08-28',
      '2026-08-30',
      '2026-08-29',
      { resume: false, recentCount: 0 }
    );
    expect(resumedFrom).toBe('2026-08-28');
    expect(days).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);
  });
});
