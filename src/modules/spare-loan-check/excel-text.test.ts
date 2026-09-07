import { describe, expect, it } from 'vitest';
import { excelTextFormula } from '@/modules/spare-loan-check/excel-text';

describe('excelTextFormula', () => {
  it('wraps digits so Excel keeps full barcode', () => {
    expect(excelTextFormula('241223456789012345')).toBe('="241223456789012345"');
  });

  it('escapes embedded quotes and skips empty', () => {
    expect(excelTextFormula('a"b')).toBe('="a""b"');
    expect(excelTextFormula('')).toBe('');
  });
});
