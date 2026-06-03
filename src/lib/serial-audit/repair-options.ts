/** Primary repair types for Serial Audit (mstrepair.vname). Set to null to show all active repairs. */
export const SERIAL_AUDIT_REPAIR_ALLOWLIST: string[] | null = [
  'Motor Replaced',
  'Compressor Replaced',
  'Gas Charging Done',
];

export const SERIAL_AUDIT_REPAIR_PRIORITY = [
  'Motor Replaced',
  'Compressor Replaced',
  'Gas Charging Done',
] as const;

export type SerialAuditRepairCounts = {
  motorReplaced: number;
  compressorReplaced: number;
  gasCharging: number;
};

export const EMPTY_SERIAL_AUDIT_REPAIR_COUNTS: SerialAuditRepairCounts = {
  motorReplaced: 0,
  compressorReplaced: 0,
  gasCharging: 0,
};

export function mapRepairCountsFromApiRow(
  row: Record<string, unknown>
): SerialAuditRepairCounts {
  return {
    motorReplaced: Number(row.motor_replaced_count) || 0,
    compressorReplaced: Number(row.compressor_replaced_count) || 0,
    gasCharging: Number(row.gas_charging_count) || 0,
  };
}

export function mergeRepairCountsIntoRows<T extends { serial: string; repairCounts: SerialAuditRepairCounts }>(
  rows: T[],
  countBySerial: Map<string, SerialAuditRepairCounts>
): T[] {
  return rows.map((row) => ({
    ...row,
    repairCounts: countBySerial.get(row.serial.toUpperCase()) ?? row.repairCounts,
  }));
}

export type RepairMasterItem = {
  ncode: string;
  vname: string;
};

export type RepairPickerItem = {
  value: string;
  vname: string;
};

export const REPAIR_CHIP_COLLAPSE_AT = 3;

export function isRepairNcodeValue(value: string): boolean {
  return /^\d+$/.test(value);
}

export function parseRepairFilterValues(values: string[]): string[] {
  return values.filter(isRepairNcodeValue);
}

export function parseRepairQueryParam(repair: string | null | undefined): string[] {
  if (!repair || repair === 'All') return [];
  return parseRepairFilterValues(
    repair
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

export function serializeRepairFilterParam(values: string[]): string {
  return values.length === 0 ? 'All' : values.join(',');
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function filterRepairMasterForPicker(items: RepairMasterItem[]): RepairMasterItem[] {
  if (!SERIAL_AUDIT_REPAIR_ALLOWLIST?.length) return items;
  const allow = new Set(SERIAL_AUDIT_REPAIR_ALLOWLIST.map(normalizeName));
  return items.filter((item) => allow.has(normalizeName(item.vname)));
}

/** Default Serial Audit repair filter: all allowlisted picker values (motor, compressor, gas). */
export function defaultSerialAuditRepairFilterValues(
  pickerItems: RepairPickerItem[]
): string[] {
  return pickerItems.map((item) => item.value);
}

export function repairMasterToPicker(master: RepairMasterItem[]): RepairPickerItem[] {
  const filtered = filterRepairMasterForPicker(master);
  const priorityIndex = new Map(
    SERIAL_AUDIT_REPAIR_PRIORITY.map((name, i) => [normalizeName(name), i])
  );
  return filtered
    .map((item) => ({ value: item.ncode, vname: item.vname }))
    .sort((a, b) => {
      const ai = priorityIndex.get(normalizeName(a.vname)) ?? 999;
      const bi = priorityIndex.get(normalizeName(b.vname)) ?? 999;
      if (ai !== bi) return ai - bi;
      return a.vname.localeCompare(b.vname, undefined, { sensitivity: 'base' });
    });
}

export function buildRepairNameMap(items: RepairPickerItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.value) map.set(item.value, item.vname);
  }
  return map;
}

export function repairLabelForValue(
  value: string,
  labelByValue: Map<string, string>
): string {
  return labelByValue.get(value) ?? value;
}
