import { describe, expect, it } from 'vitest';
import { resolveFilterSelectSearchable } from '@/components/filters/filter-select-utils';
import type { FilterSelectOption } from '@/components/filters/filter-select-types';

describe('resolveFilterSelectSearchable', () => {
  const opts = (n: number): FilterSelectOption[] =>
    Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Opt ${i}` }));

  it('defaults to searchable when options exceed threshold', () => {
    expect(resolveFilterSelectSearchable(undefined, opts(7))).toBe(true);
    expect(resolveFilterSelectSearchable(undefined, opts(6))).toBe(false);
  });

  it('respects explicit searchable override', () => {
    expect(resolveFilterSelectSearchable(false, opts(10))).toBe(false);
    expect(resolveFilterSelectSearchable(true, opts(3))).toBe(true);
  });
});
