import { describe, expect, it } from 'vitest';
import {
  isValidChipDomain,
  isValidChipEmail,
  normalizeChipDomain,
  normalizeChipEmail,
} from '@/features/mis-email/components/TagChipsInput';

describe('TagChipsInput helpers', () => {
  it('normalizes and validates emails', () => {
    expect(normalizeChipEmail('  Sam@WesternEquipments.com ')).toBe(
      'sam@westernequipments.com'
    );
    expect(isValidChipEmail('sam@westernequipments.com')).toBe(true);
    expect(isValidChipEmail('not-an-email')).toBe(false);
  });

  it('normalizes and validates domains', () => {
    expect(normalizeChipDomain('@WesternEquipments.com')).toBe('westernequipments.com');
    expect(isValidChipDomain('westernequipments.com')).toBe(true);
    expect(isValidChipDomain('bad domain')).toBe(false);
  });
});
