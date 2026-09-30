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

/** CRM names often already start with "1182 - PATNA BRANCH" — show the code once. */
export function formatSpareStockPlantLabel(code: string, branchName?: string | null): string {
  const plant = code.trim();
  const name = branchName?.trim();
  if (!plant) return name ?? '';
  if (!name) return plant;
  const escaped = plant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rest = name.replace(new RegExp(`^${escaped}\\s*[-—–:]\\s*`, 'i'), '').trim();
  return rest ? `${plant} — ${rest}` : plant;
}

export function formatSpareStockSupplierLabel(code: string, companyName?: string | null): string {
  const vendor = code.trim();
  const name = companyName?.trim();
  if (!vendor) return name ?? '';
  if (!name) return vendor;
  return `${vendor} — ${name}`;
}
