import { sortWarrantyMasterAggregateRows, sortWarrantyMasterFgDetailRows } from './sort';
import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterClientFilters,
  WarrantyMasterDims,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterHierarchyGroup,
  WarrantyMasterHierarchySubgroup,
  WarrantyMasterHierarchyWarranty,
  WarrantyMasterSummary,
} from './types';

function compactLabel(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizedTextKey(value: unknown): string {
  const text = compactLabel(value);
  return text ? text.toLocaleLowerCase() : '__unknown__';
}

function displayScore(value: string): number {
  const text = compactLabel(value);
  if (!text) return -1;
  const hasLower = /[a-z]/.test(text);
  const hasUpper = /[A-Z]/.test(text);
  const mixed = hasLower && hasUpper ? 2 : 0;
  const titleLike = text
    .split(/\s+/)
    .every((part) => !part || part[0] === part[0]?.toUpperCase());
  return mixed + (titleLike ? 1 : 0);
}

function chooseDisplayLabel(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const text = compactLabel(value);
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  if (counts.size === 0) return '(Unknown)';
  return [...counts.entries()]
    .sort((a, b) =>
      b[1] - a[1] ||
      displayScore(b[0]) - displayScore(a[0]) ||
      a[0].localeCompare(b[0], undefined, { sensitivity: 'base', numeric: true })
    )[0][0];
}

/**
 * Canonicalize subgroup/group display values without destroying source data.
 * e.g. VADILAL / Vadilal / vadilal become one UI value: Vadilal.
 */
export function normalizeWarrantyMasterFgLinesForUi(
  lines: WarrantyMasterFgLineRow[]
): WarrantyMasterFgLineRow[] {
  const subgroupVariants = new Map<string, string[]>();
  const groupVariants = new Map<string, string[]>();

  for (const line of lines) {
    const subgroup = compactLabel(line.customerSubgroup);
    const group = compactLabel(line.groupName);
    const subgroupKey = normalizedTextKey(subgroup);
    const groupKey = normalizedTextKey(group);
    if (subgroup) {
      const bucket = subgroupVariants.get(subgroupKey);
      if (bucket) bucket.push(subgroup);
      else subgroupVariants.set(subgroupKey, [subgroup]);
    }
    if (group) {
      const bucket = groupVariants.get(groupKey);
      if (bucket) bucket.push(group);
      else groupVariants.set(groupKey, [group]);
    }
  }

  const subgroupLabels = new Map(
    [...subgroupVariants.entries()].map(([key, values]) => [key, chooseDisplayLabel(values)] as const)
  );
  const groupLabels = new Map(
    [...groupVariants.entries()].map(([key, values]) => [key, chooseDisplayLabel(values)] as const)
  );

  return lines.map((line) => {
    const subgroup = compactLabel(line.customerSubgroup);
    const group = compactLabel(line.groupName);
    const subgroupKey = normalizedTextKey(subgroup);
    const groupKey = normalizedTextKey(group);
    return {
      ...line,
      customerSubgroup: subgroupLabels.get(subgroupKey) ?? '(Unknown)',
      customerKey: subgroupKey,
      groupName: groupLabels.get(groupKey) ?? '(Unknown)',
      groupKey,
    };
  });
}

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
    if (!includesAny(filters.selectedCustomer, line.customerSubgroup)) return false;
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
        customerSubgroup: line.customerSubgroup,
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

export function buildWarrantyMasterHierarchy(
  lines: WarrantyMasterFgLineRow[],
  filters: WarrantyMasterClientFilters
): WarrantyMasterHierarchySubgroup[] {
  const subgroupMap = new Map<
    string,
    {
      label: string;
      machineCount: number;
      groups: Map<string, { label: string; machineCount: number; warranties: Map<number, WarrantyMasterHierarchyWarranty> }>;
    }
  >();

  for (const line of lines) {
    const count = effectiveCount(line, filters);
    if (count <= 0) continue;

    const subgroupKey = line.customerKey || normalizedTextKey(line.customerSubgroup);
    const groupKey = line.groupKey || normalizedTextKey(line.groupName);
    let subgroup = subgroupMap.get(subgroupKey);
    if (!subgroup) {
      subgroup = { label: line.customerSubgroup || '(Unknown)', machineCount: 0, groups: new Map() };
      subgroupMap.set(subgroupKey, subgroup);
    }
    subgroup.machineCount += count;

    let group = subgroup.groups.get(groupKey);
    if (!group) {
      group = { label: line.groupName || '(Unknown)', machineCount: 0, warranties: new Map() };
      subgroup.groups.set(groupKey, group);
    }
    group.machineCount += count;

    const existingWarranty = group.warranties.get(line.warrantyMonths);
    if (existingWarranty) {
      existingWarranty.machineCount += count;
      if (line.minWarrEnd && (!existingWarranty.minWarrEnd || line.minWarrEnd < existingWarranty.minWarrEnd)) {
        existingWarranty.minWarrEnd = line.minWarrEnd;
      }
      if (line.maxWarrEnd && (!existingWarranty.maxWarrEnd || line.maxWarrEnd > existingWarranty.maxWarrEnd)) {
        existingWarranty.maxWarrEnd = line.maxWarrEnd;
      }
    } else {
      group.warranties.set(line.warrantyMonths, {
        warrantyMonths: line.warrantyMonths,
        machineCount: count,
        minWarrEnd: line.minWarrEnd,
        maxWarrEnd: line.maxWarrEnd,
      });
    }
  }

  return [...subgroupMap.entries()]
    .map(([subgroupKey, subgroup]) => ({
      subgroupKey,
      customerSubgroup: subgroup.label,
      machineCount: subgroup.machineCount,
      groups: [...subgroup.groups.entries()]
        .map(([groupKey, group]): WarrantyMasterHierarchyGroup => ({
          groupKey,
          groupName: group.label,
          machineCount: group.machineCount,
          warranties: [...group.warranties.values()].sort((a, b) => a.warrantyMonths - b.warrantyMonths),
        }))
        .sort((a, b) => a.groupName.localeCompare(b.groupName, undefined, { sensitivity: 'base', numeric: true })),
    }))
    .sort((a, b) => a.customerSubgroup.localeCompare(b.customerSubgroup, undefined, { sensitivity: 'base', numeric: true }));
}

export function buildWarrantyMasterDimsFromFgLines(
  lines: WarrantyMasterFgLineRow[]
): WarrantyMasterDims {
  const customerMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const fgSet = new Set<string>();
  const monthsSet = new Set<number>();

  for (const line of lines) {
    customerMap.set(line.customerSubgroup, line.customerSubgroup);
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
  const distinctCustomers = new Set(rows.map((r) => r.customerSubgroup)).size;
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
