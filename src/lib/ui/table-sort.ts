'use client';

import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export type TableSortState<K extends string = string> = {
  key: K;
  dir: SortDir;
};

export function toggleSort<K extends string>(
  prev: TableSortState<K> | null,
  key: K,
  defaultDir: SortDir = 'asc'
): TableSortState<K> {
  if (prev?.key === key) {
    return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: defaultDir };
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '';
}

/** Null/empty last; numbers & booleans numeric; else localeCompare. */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const mul = dir === 'asc' ? 1 : -1;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * mul;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (Number(a) - Number(b)) * mul;
  }

  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (
    typeof a !== 'boolean' &&
    typeof b !== 'boolean' &&
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    String(a).trim() !== '' &&
    String(b).trim() !== '' &&
    !Number.isNaN(na) &&
    !Number.isNaN(nb) &&
    // Prefer string compare when both look like non-numeric labels (e.g. codes with letters)
    (typeof a === 'number' || typeof b === 'number' || /^-?\d+(\.\d+)?$/.test(String(a).trim()))
  ) {
    return (na - nb) * mul;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * mul;
}

export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => unknown,
  dir: SortDir
): T[] {
  return [...rows].sort((a, b) => compareValues(getValue(a), getValue(b), dir));
}

export function sortRowsByKey<T extends Record<string, unknown>, K extends keyof T & string>(
  rows: readonly T[],
  key: K,
  dir: SortDir
): T[] {
  return sortRows(rows, (row) => row[key], dir);
}

export function useTableSort<K extends string>(initial: TableSortState<K> | null = null) {
  const [sort, setSort] = useState<TableSortState<K> | null>(initial);

  const onSort = useCallback((key: K, defaultDir: SortDir = 'asc') => {
    setSort((prev) => toggleSort(prev, key, defaultDir));
  }, []);

  const sorted = useCallback(
    <T,>(rows: readonly T[], getValue: (row: T, key: K) => unknown): T[] => {
      if (!sort) return [...rows];
      return sortRows(rows, (row) => getValue(row, sort.key), sort.dir);
    },
    [sort]
  );

  return useMemo(() => ({ sort, setSort, onSort, sorted }), [sort, onSort, sorted]);
}
