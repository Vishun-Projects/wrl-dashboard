import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
} from './types';

export function toNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAggregateRows(raw: Record<string, unknown>[]): WarrantyMasterAggregateRow[] {
  return raw.map((row) => ({
    customerName: String(row.customerName ?? row.CustomerName ?? ''),
    groupName: String(row.groupName ?? row.GroupName ?? ''),
    customerKey: String(row.customerKey ?? row.CustomerKey ?? '').trim(),
    groupKey: String(row.groupKey ?? row.GroupKey ?? '').trim(),
    warrantyMonths: toNumber(row.warrantyMonths ?? row.WarrantyMonths),
    machineCount: toNumber(row.machineCount ?? row.MachineCount),
  }));
}

export function normalizeFgDetailRows(raw: Record<string, unknown>[]): WarrantyMasterFgDetailRow[] {
  return raw.map((row) => ({
    fgModel: String(row.fgModel ?? row.FgModel ?? row.FGModel ?? ''),
    machineCount: toNumber(row.machineCount ?? row.MachineCount),
  }));
}

export function normalizeFgLineRows(raw: Record<string, unknown>[]): WarrantyMasterFgLineRow[] {
  return raw.map((row) => {
    const minWarrEnd = row.minWarrEnd ?? row.MinWarrEnd;
    const maxWarrEnd = row.maxWarrEnd ?? row.MaxWarrEnd;
    return {
      customerName: String(row.customerName ?? row.CustomerName ?? ''),
      groupName: String(row.groupName ?? row.GroupName ?? ''),
      customerKey: String(row.customerKey ?? row.CustomerKey ?? '').trim(),
      groupKey: String(row.groupKey ?? row.GroupKey ?? '').trim(),
      warrantyMonths: toNumber(row.warrantyMonths ?? row.WarrantyMonths),
      fgModel: String(row.fgModel ?? row.FgModel ?? row.FGModel ?? ''),
      machineCount: toNumber(row.machineCount ?? row.MachineCount),
      activeMachineCount: toNumber(row.activeMachineCount ?? row.ActiveMachineCount),
      minWarrEnd: minWarrEnd != null && minWarrEnd !== '' ? String(minWarrEnd).slice(0, 10) : null,
      maxWarrEnd: maxWarrEnd != null && maxWarrEnd !== '' ? String(maxWarrEnd).slice(0, 10) : null,
    };
  });
}
