import { describe, expect, it } from 'vitest';
import { compareValues, sortRows, toggleSort } from '@/lib/ui/table-sort';

describe('table-sort', () => {
  it('toggleSort flips same key and resets on new key', () => {
    expect(toggleSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'total', 'desc')).toEqual({
      key: 'total',
      dir: 'desc',
    });
  });

  it('compareValues puts nulls last and sorts numbers/strings', () => {
    expect(compareValues(1, 2, 'asc')).toBeLessThan(0);
    expect(compareValues(1, 2, 'desc')).toBeGreaterThan(0);
    expect(compareValues('b', 'a', 'asc')).toBeGreaterThan(0);
    expect(compareValues(null, 1, 'asc')).toBeGreaterThan(0);
    expect(compareValues(1, null, 'asc')).toBeLessThan(0);
  });

  it('sortRows orders by getter', () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual([1, 2, 3]);
    expect(sortRows(rows, (r) => r.n, 'desc').map((r) => r.n)).toEqual([3, 2, 1]);
  });
});
