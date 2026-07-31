import { describe, expect, it } from 'vitest';
import { isPracticeWinmaxOfficeName } from '@/sql/read-model/summary-call-filters';

describe('isPracticeWinmaxOfficeName', () => {
  it('flags WinMax practice offices', () => {
    expect(isPracticeWinmaxOfficeName('Z WinMax Practice Branch Office')).toBe(true);
    expect(isPracticeWinmaxOfficeName('Z WINMAX BRANCH OFFICE 3')).toBe(true);
  });

  it('flags Western Head Office test branch', () => {
    expect(isPracticeWinmaxOfficeName('WESTERN HEAD OFFICE - 1100')).toBe(true);
    expect(isPracticeWinmaxOfficeName('Western Head Office-1100')).toBe(true);
  });

  it('allows normal franchisee offices', () => {
    expect(isPracticeWinmaxOfficeName('SIDDHIVINAYAK REFRIGERATION')).toBe(false);
    expect(isPracticeWinmaxOfficeName('1171 - MUMBAI BRANCH')).toBe(false);
  });
});
