import { describe, expect, it } from 'vitest';
import { recentEditedonDays } from './editedon-catchup';

describe('recentEditedonDays', () => {
  it('returns inclusive trailing calendar days ending at endDay', () => {
    expect(recentEditedonDays('2026-07-20', 2)).toEqual(['2026-07-19', '2026-07-20']);
    expect(recentEditedonDays('2026-07-20', 1)).toEqual(['2026-07-20']);
    expect(recentEditedonDays('2026-07-20', 0)).toEqual([]);
  });
});
