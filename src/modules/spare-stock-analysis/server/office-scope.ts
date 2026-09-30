import { postQuery } from '@/lib/db/proxy';
import { withAppClient } from '@/lib/read-model/db';
import { lookupPlantMeta } from '@/modules/spare-loan-check';
import {
  formatSpareStockPlantLabel,
  formatSpareStockSupplierLabel,
} from '@/modules/spare-stock-analysis/plants';
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

export async function spareStockPlantLabels(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const meta = await lookupPlantMeta(unique);
  return new Map(unique.map((c) => [c, formatSpareStockPlantLabel(c, meta.get(c)?.plantName)]));
}

/** SAP supplier / vendor code → "code — company" from dim_offices. */
export async function spareStockSupplierLabels(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  return withAppClient(async (client) => {
    const { rows } = await client.query<{ code: string; name: string | null }>(
      `
      SELECT DISTINCT
        NULLIF(btrim(vsapvendorcode), '') AS code,
        NULLIF(btrim(vcompanyname), '') AS name
      FROM dim_offices
      WHERE NULLIF(btrim(vsapvendorcode), '') = ANY($1::text[])
      `,
      [unique]
    );
    const names = new Map<string, string>();
    for (const row of rows) {
      const code = String(row.code ?? '').trim();
      if (!code || names.has(code)) continue;
      names.set(code, String(row.name ?? '').trim());
    }
    return new Map(
      unique.map((c) => [c, formatSpareStockSupplierLabel(c, names.get(c) || null)])
    );
  });
}
