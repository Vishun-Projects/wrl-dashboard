/** SAP plants that are never spare-stock ledger (wrong company / not in scope). */
export const SPARE_STOCK_EXCLUDED_PLANTS = [
  '1125',
  '1129',
  '1130',
  '1169',
  '1177',
  '1178',
  '1179',
  '1183',
  '1191',
] as const;

const EXCLUDED = new Set<string>(SPARE_STOCK_EXCLUDED_PLANTS);

export function isSpareStockPlantExcluded(plant: string): boolean {
  return EXCLUDED.has(plant.replace(/\s+/g, ''));
}

export function formatSpareStockPlantLabel(code: string, branchName?: string | null): string {
  const name = branchName?.trim();
  return name ? `${code} — ${name}` : code;
}
