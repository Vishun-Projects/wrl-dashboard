import { describe, expect, it } from 'vitest';
import { isPlantInScope } from './office-scope';

describe('isPlantInScope', () => {
  it('allows any plant when unrestricted', () => {
    expect(isPlantInScope('1152', null)).toBe(true);
  });

  it('rejects out-of-scope plant', () => {
    expect(isPlantInScope('9999', ['1152', '1101'])).toBe(false);
  });
});
