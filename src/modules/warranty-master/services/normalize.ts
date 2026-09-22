import type {
  WarrantyMasterAggregateRow,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterSerialRow,
} from './types';

export function toNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAggregateRows(raw: Record<string, unknown>[]): WarrantyMasterAggregateRow[] {
  return raw.map((row) => ({
    customerName: String(row.customerName ?? row.CustomerName ?? ''),
    customerSubgroup: String(
      row.customerSubgroup ?? row.CustomerSubgroup ?? row.customer_subgroup ?? '(Unknown)'
    ).trim() || '(Unknown)',
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
      customerSubgroup: String(
      row.customerSubgroup ?? row.CustomerSubgroup ?? row.customer_subgroup ?? '(Unknown)'
    ).trim() || '(Unknown)',
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

export function normalizeSerialRows(raw: Record<string, unknown>[]): WarrantyMasterSerialRow[] {
  return raw.map((row) => {
    const warrStartDt = row.warrStartDt ?? row.WarrStartDt ?? row.warr_start_dt;
    const warrEndDt = row.warrEndDt ?? row.WarrEndDt ?? row.warr_end_dt;
    const isActiveRaw = row.isActive ?? row.IsActive ?? row.is_active;
    const isActive =
      isActiveRaw === true ||
      isActiveRaw === 'true' ||
      isActiveRaw === '1' ||
      isActiveRaw === 1;

    return {
      ncode: row.ncode ? Number(row.ncode) : undefined,
      serialNo: String(row.serialNo ?? row.SerialNo ?? row.serial_no ?? '').trim(),
      customerName: String(row.customerName ?? row.CustomerName ?? row.customer_name ?? ''),
      customerSubgroup: String(
        row.customerSubgroup ?? row.CustomerSubgroup ?? row.customer_subgroup ?? ''
      ).trim() || '(Unknown)',
      groupName: String(row.groupName ?? row.GroupName ?? row.group_name ?? ''),
      customerKey: String(row.customerKey ?? row.CustomerKey ?? row.customer_key ?? '').trim(),
      groupKey: String(row.groupKey ?? row.GroupKey ?? row.group_key ?? '').trim(),
      warrantyMonths: toNumber(row.warrantyMonths ?? row.WarrantyMonths ?? row.warranty_months),
      fgModel: String(row.fgModel ?? row.FgModel ?? row.FGModel ?? row.fg_model ?? ''),
      warrStartDt: warrStartDt != null && warrStartDt !== '' ? String(warrStartDt).slice(0, 10) : null,
      warrEndDt: warrEndDt != null && warrEndDt !== '' ? String(warrEndDt).slice(0, 10) : null,
      isActive,
    };
  });
}
