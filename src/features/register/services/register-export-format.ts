import { formatExportDate } from '@/lib/utils/export-dates';

/** Register CSV/Excel date cells — DD.MM.YYYY (e.g. 25.06.2026). */
export const formatRegisterExportDate = formatExportDate;

/** Matches register UI: any major repair fault → Major, else Minor. */
export function formatRegisterMajorMinor(row: Record<string, unknown>): 'Major' | 'Minor' {
  const v = row.is_major_repair ?? row.is_major;
  if (v === true || v === 'True' || v === '1' || v === 1) return 'Major';
  return 'Minor';
}

/** CSV / table label for Motor / Compressor / Gas from repair_done string. */
export function formatRegisterRepairDone(repairDone: unknown): string {
  const raw = String(repairDone ?? '');
  const parts: string[] = [];
  if (raw.includes('Motor Replaced')) parts.push('Motor');
  if (raw.includes('Compressor Replaced')) parts.push('Compressor');
  if (raw.includes('Gas Charging Done')) parts.push('Gas');
  return parts.join('; ');
}
