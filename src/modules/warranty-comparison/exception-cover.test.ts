import { describe, expect, it } from 'vitest';
import { foldAccountName } from './account-label';
import {
  addCalendarMonths,
  coverageReason,
  isAmcCovered,
  isCompressorWindow,
} from './exception-cover';

const amcAccount = {
  systemAccount: 'Sarvaraya sugars',
  amc: true,
  amcValidUpto: '9999-12-31',
  compressorWarrantyMonths: null,
  workDoneMode: 'none' as const,
};

const compressorAccount = {
  systemAccount: 'Pepsi-Bott',
  amc: false,
  amcValidUpto: null,
  compressorWarrantyMonths: 36,
  workDoneMode: 'selected' as const,
};

describe('exception cover', () => {
  it('covers AMC when call date is on or before valid-upto', () => {
    expect(isAmcCovered('2026-09-24', amcAccount)).toBe(true);
    expect(isAmcCovered('9999-12-31', amcAccount)).toBe(true);
    expect(isAmcCovered('2026-09-24', { ...amcAccount, amc: false })).toBe(false);
  });

  it('covers compressor from warranty start + months', () => {
    expect(addCalendarMonths('2023-01-15', 36)).toBe('2026-01-15');
    expect(isCompressorWindow('2026-01-15', '2023-01-15', 36)).toBe(true);
    expect(isCompressorWindow('2026-01-16', '2023-01-15', 36)).toBe(false);
    expect(isCompressorWindow('2026-01-15', '2023-01-15', null)).toBe(false);
  });

  it('prefers AMC over compressor and folds account case', () => {
    expect(coverageReason('2026-01-10', '2023-01-15', compressorAccount, true)).toBe(
      'Compressor'
    );
    expect(coverageReason('2026-01-10', '2023-01-15', compressorAccount, false)).toBe(null);
    expect(
      coverageReason('2026-01-10', '2023-01-15', { ...amcAccount, compressorWarrantyMonths: 36 }, true)
    ).toBe('AMC');

    const map = new Map<string, string>();
    foldAccountName(map, 'PEPSI-BOTT');
    foldAccountName(map, 'Pepsi-Bott');
    expect([...map.values()]).toEqual(['Pepsi-Bott']);
  });
});
