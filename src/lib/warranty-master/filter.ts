import { sortWarrantyMasterAggregateRows, sortWarrantyMasterFgDetailRows } from './sort';
import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterClientFilters,
  WarrantyMasterDims,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterSummary,
} from './types';

function includesAny(selected: string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value);
}

function lineOverlapsWarrEndRange(
  line: WarrantyMasterFgLineRow,
  from: string,
  to: string
): boolean {
  if (!from && !to) return true;
  if (!line.minWarrEnd || !line.maxWarrEnd) return false;
  if (from && line.maxWarrEnd < from) return false;
  if (to && line.minWarrEnd > to) return false;
  return true;
}

function effectiveCount(line: WarrantyMasterFgLineRow, filters: WarrantyMasterClientFilters): number {
  return filters.activeOnly ? line.activeMachineCount : line.machineCount;
}

export function filterWarrantyMasterFgLines(
  lines: WarrantyMasterFgLineRow[],
  filters: WarrantyMasterClientFilters
): WarrantyMasterFgLineRow[] {
  const warrEndFrom = filters.warrEndFrom.trim();
  const warrEndTo = filters.warrEndTo.trim();

  return lines.filter((line) => {
    if (!includesAny(filters.selectedCustomer, line.customerKey)) return false;
    if (!includesAny(filters.selectedGroup, line.groupKey)) return false;
    if (!includesAny(filters.selectedFgModel, line.fgModel)) return false;
    if (
      filters.selectedWarrantyMonths.length > 0 &&
      !filters.selectedWarrantyMonths.includes(String(line.warrantyMonths))
    ) {
      return false;
    }
    if (!lineOverlapsWarrEndRange(line, warrEndFrom, warrEndTo)) return false;
    if (filters.activeOnly && line.activeMachineCount <= 0) return false;
    return true;
  });
}

export function aggregateWarrantyMasterFgLines(
  lines: WarrantyMasterFgLineRow[],
  filters: WarrantyMasterClientFilters
): WarrantyMasterAggregateRow[] {
  const buckets = new Map<string, WarrantyMasterAggregateRow>();

  for (const line of lines) {
    const count = effectiveCount(line, filters);
    if (count <= 0) continue;

    const key = `${line.customerKey}::${line.groupKey}::${line.warrantyMonths}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.machineCount += count;
    } else {
      buckets.set(key, {
        customerName: line.customerName,
        groupName: line.groupName,
        customerKey: line.customerKey,
        groupKey: line.groupKey,
        warrantyMonths: line.warrantyMonths,
        machineCount: count,
      });
    }
  }

  return sortWarrantyMasterAggregateRows([...buckets.values()]);
}

export function buildWarrantyMasterDimsFromFgLines(
  lines: WarrantyMasterFgLineRow[]
): WarrantyMasterDims {
  const customerMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const fgSet = new Set<string>();
  const monthsSet = new Set<number>();

  for (const line of lines) {
    customerMap.set(line.customerKey, line.customerName);
    groupMap.set(line.groupKey, line.groupName);
    if (line.fgModel) fgSet.add(line.fgModel);
    monthsSet.add(line.warrantyMonths);
  }

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  return {
    customers: [...customerMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    groups: [...groupMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    fgModels: [...fgSet]
      .map((value) => ({ value, label: value }))
      .sort((a, b) => collator.compare(a.label, b.label)),
    warrantyMonths: [...monthsSet].sort((a, b) => a - b),
  };
}

export function summarizeWarrantyMasterRows(rows: WarrantyMasterAggregateRow[]): WarrantyMasterSummary {
  const totalMachines = rows.reduce((sum, r) => sum + r.machineCount, 0);
  const distinctCustomers = new Set(rows.map((r) => r.customerKey)).size;
  const distinctGroups = new Set(rows.map((r) => r.groupName)).size;
  return { totalMachines, distinctCustomers, distinctGroups };
}

export function fgDetailRowsForAggregate(
  lines: WarrantyMasterFgLineRow[],
  row: WarrantyMasterAggregateRow,
  filters: WarrantyMasterClientFilters
): WarrantyMasterFgDetailRow[] {
  const detail = lines
    .filter(
      (line) =>
        line.customerKey === row.customerKey &&
        line.groupKey === row.groupKey &&
        line.warrantyMonths === row.warrantyMonths
    )
    .map((line) => ({
      fgModel: line.fgModel,
      machineCount: effectiveCount(line, filters),
    }))
    .filter((d) => d.machineCount > 0);

  return sortWarrantyMasterFgDetailRows(detail);
}

export type WarrantyMasterFgDetailIndex = Map<string, WarrantyMasterFgLineRow[]>;

/** O(1) bucket lookup for expanded-row FG detail (avoids scanning all lines per row). */
export function buildWarrantyMasterFgDetailIndex(
  lines: WarrantyMasterFgLineRow[]
): WarrantyMasterFgDetailIndex {
  const index: WarrantyMasterFgDetailIndex = new Map();
  for (const line of lines) {
    const key = `${line.customerKey}::${line.groupKey}::${line.warrantyMonths}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(line);
    else index.set(key, [line]);
  }
  return index;
}

export function aggregateRowKey(row: WarrantyMasterAggregateRow): string {
  return `${row.customerKey || row.customerName}::${row.groupKey || row.groupName}::${row.warrantyMonths}`;
}

export function fgDetailRowsForAggregateFromIndex(
  index: WarrantyMasterFgDetailIndex,
  row: WarrantyMasterAggregateRow,
  filters: WarrantyMasterClientFilters
): WarrantyMasterFgDetailRow[] {
  const lines = index.get(aggregateRowKey(row)) ?? [];
  const detail = lines
    .map((line) => ({
      fgModel: line.fgModel,
      machineCount: effectiveCount(line, filters),
    }))
    .filter((d) => d.machineCount > 0);

  return sortWarrantyMasterFgDetailRows(detail);
}
