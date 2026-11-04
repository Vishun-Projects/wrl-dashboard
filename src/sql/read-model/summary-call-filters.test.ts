import { describe, expect, it } from 'vitest';
import {
  isImportReplacedCrmAccount,
  isPracticeWinmaxOfficeName,
} from '@/sql/read-model/summary-call-filters';

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

describe('isImportReplacedCrmAccount', () => {
  it('flags Cadbury/Mondelez and Coke/HCCB', () => {
    expect(isImportReplacedCrmAccount('Cadbury')).toBe(true);
    expect(isImportReplacedCrmAccount('MONDELEZ')).toBe(true);
    expect(isImportReplacedCrmAccount('Coke')).toBe(true);
    expect(isImportReplacedCrmAccount('HCCB')).toBe(true);
  });

  it('keeps normal CRM accounts on branch', () => {
    expect(isImportReplacedCrmAccount('Nestle')).toBe(false);
    expect(isImportReplacedCrmAccount('Pepsi')).toBe(false);
  });
});
