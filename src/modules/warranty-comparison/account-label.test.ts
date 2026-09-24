import { describe, expect, it } from 'vitest';
import { foldAccountName } from './account-label';

describe('foldAccountName', () => {
  it('keeps one name and prefers mixed case over ALL CAPS', () => {
    const map = new Map<string, string>();
    foldAccountName(map, 'CADBURRY');
    foldAccountName(map, 'Cadburry');
    foldAccountName(map, 'cadburry');
    expect([...map.values()]).toEqual(['Cadburry']);
  });
});
