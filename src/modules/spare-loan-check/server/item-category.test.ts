import { describe, expect, it } from 'vitest';
import { normalizeMaterialCode } from '@/modules/spare-loan-check/server/item-category';

describe('normalizeMaterialCode', () => {
  it('strips leading zeros like SAP vs CRM recon', () => {
    expect(normalizeMaterialCode('01513755')).toBe('1513755');
    expect(normalizeMaterialCode('1513755')).toBe('1513755');
    expect(normalizeMaterialCode('  1110714  ')).toBe('1110714');
  });
});
