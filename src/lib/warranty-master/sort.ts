import type { WarrantyMasterAggregateRow, WarrantyMasterFgDetailRow } from './types';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareText(a: string, b: string): number {
  return collator.compare(a.trim(), b.trim());
}

function compareWarrantyMonths(a: number, b: number): number {
  const am = Number(a);
  const bm = Number(b);
  if (!Number.isFinite(am) && !Number.isFinite(bm)) return 0;
  if (!Number.isFinite(am)) return 1;
  if (!Number.isFinite(bm)) return -1;
  return am - bm;
}

export function sortWarrantyMasterAggregateRows(
  rows: WarrantyMasterAggregateRow[]
): WarrantyMasterAggregateRow[] {
  return [...rows].sort((a, b) => {
    const byCustomer = compareText(a.customerName, b.customerName);
    if (byCustomer !== 0) return byCustomer;
    const byGroup = compareText(a.groupName, b.groupName);
    if (byGroup !== 0) return byGroup;
    return compareWarrantyMonths(a.warrantyMonths, b.warrantyMonths);
  });
}

export function sortWarrantyMasterFgDetailRows(
  rows: WarrantyMasterFgDetailRow[]
): WarrantyMasterFgDetailRow[] {
  return [...rows].sort((a, b) => compareText(a.fgModel, b.fgModel));
}

export function sortWarrantyMonthValues(months: number[]): number[] {
  return [...months].sort((a, b) => a - b);
}
