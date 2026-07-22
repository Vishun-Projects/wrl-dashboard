/** CSV / table label for Motor / Compressor / Gas from repair_done string. */
export function formatRegisterRepairDone(repairDone: unknown): string {
  const raw = String(repairDone ?? '');
  const parts: string[] = [];
  if (raw.includes('Motor Replaced')) parts.push('Motor');
  if (raw.includes('Compressor Replaced')) parts.push('Compressor');
  if (raw.includes('Gas Charging Done')) parts.push('Gas');
  return parts.join('; ');
}
