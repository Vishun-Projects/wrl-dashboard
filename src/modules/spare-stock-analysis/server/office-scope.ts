import { postQuery } from '@/lib/db/proxy';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';

/** null = unrestricted; otherwise SAP plant codes the user may see. */
export async function resolveAllowedSpareStockPlants(
  isHod: boolean,
  assignedOffices: string[]
): Promise<string[] | null> {
  if (!shouldRestrictToAssignedOffices(isHod, assignedOffices)) return null;

  const ids = assignedOffices.map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];

  const inList = ids.join(',');
  const res = await postQuery({
    rawSql: `
SELECT DISTINCT LTRIM(RTRIM(o.vsapplantcode)) AS plant_code
FROM mstoffice o (NOLOCK)
WHERE (o.ncode IN (${inList}) OR o.nunder IN (${inList}))
  AND o.vsapplantcode IS NOT NULL
  AND LTRIM(RTRIM(o.vsapplantcode)) <> ''
`,
    timeoutMs: 60_000,
  });

  const plants = new Set<string>();
  for (const row of res?.data ?? []) {
    const code = String((row as { plant_code?: unknown }).plant_code ?? '').trim();
    if (code) plants.add(code);
  }
  return [...plants];
}

export function isPlantInScope(plant: string, allowedPlants: string[] | null): boolean {
  if (allowedPlants == null) return true;
  return allowedPlants.some((p) => p === plant.trim());
}
