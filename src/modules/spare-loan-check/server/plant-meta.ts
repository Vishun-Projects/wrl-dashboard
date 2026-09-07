import { Client } from 'pg';
import { postQuery } from '@/lib/db/proxy';
import { loadEnv, withAppClient } from '@/lib/read-model/db';
import type { SpareLoanProblemRow } from '@/modules/spare-loan-check/types';

export type PlantMeta = {
  plantName: string | null;
  zone: string | null;
};

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizePlantCode(code: string): string {
  return code.trim();
}

const CRM_CHUNK = 80;

type CrmPlantRow = {
  plant_code: string;
  plant_name: string | null;
  zone_name: string | null;
};

async function lookupCrmFromOld(codes: string[]): Promise<Map<string, PlantMeta>> {
  const map = new Map<string, PlantMeta>();
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL?.trim();
  if (!url) return map;

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<CrmPlantRow>(
      `
      SELECT
        btrim(o.vsapplantcode) AS plant_code,
        NULLIF(btrim(o.vcompanyname), '') AS plant_name,
        NULLIF(btrim(z.vname), '') AS zone_name
      FROM crm_raw.mstoffice o
      LEFT JOIN crm_raw.mstzones z ON z.ncode = o.nzone
      WHERE o.vsapplantcode IS NOT NULL
        AND btrim(o.vsapplantcode) <> ''
        AND btrim(o.vsapplantcode) = ANY($1::text[])
      `,
      [codes]
    );
    for (const row of rows) {
      const key = normalizePlantCode(String(row.plant_code ?? ''));
      if (!key || map.has(key)) continue;
      map.set(key, {
        plantName: row.plant_name ? String(row.plant_name).trim() : null,
        zone: row.zone_name ? String(row.zone_name).trim() : null,
      });
    }
  } catch (err) {
    console.warn(
      '[spare-loan-check] old_crm plant meta lookup failed:',
      err instanceof Error ? err.message : err
    );
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
  return map;
}

async function lookupCrmFromLive(codes: string[]): Promise<Map<string, PlantMeta>> {
  const map = new Map<string, PlantMeta>();
  for (let i = 0; i < codes.length; i += CRM_CHUNK) {
    const chunk = codes.slice(i, i + CRM_CHUNK);
    const inList = chunk.map((c) => `'${escapeSqlLiteral(c)}'`).join(',');
    try {
      const res = await postQuery({
        rawSql: `
SELECT
  LTRIM(RTRIM(o.vsapplantcode)) AS plant_code,
  LTRIM(RTRIM(o.vcompanyname)) AS plant_name,
  LTRIM(RTRIM(z.vname)) AS zone_name
FROM mstoffice o (NOLOCK)
LEFT JOIN mstzones z (NOLOCK) ON CAST(z.ncode AS VARCHAR(50)) = CAST(o.nzone AS VARCHAR(50))
WHERE LTRIM(RTRIM(o.vsapplantcode)) IN (${inList})
`,
        timeoutMs: 60_000,
      });
      for (const row of res.data ?? []) {
        const key = normalizePlantCode(String(row.plant_code ?? ''));
        if (!key || map.has(key)) continue;
        const plantName = String(row.plant_name ?? '').trim() || null;
        const zone = String(row.zone_name ?? '').trim() || null;
        map.set(key, { plantName, zone });
      }
    } catch (err) {
      console.warn(
        '[spare-loan-check] live CRM plant meta chunk failed:',
        err instanceof Error ? err.message : err
      );
      break;
    }
  }
  return map;
}

async function lookupZonesFromPlantMap(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const numeric = codes
    .map((c) => Number(c))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n));
  if (numeric.length === 0) return map;

  try {
    await withAppClient(async (client) => {
      const { rows } = await client.query<{ office_id: string; region_zone: string }>(
        `
        SELECT office_id::text AS office_id, region_zone
        FROM mis_plant_region_mappings
        WHERE office_id = ANY($1::bigint[])
        `,
        [numeric]
      );
      for (const row of rows) {
        const key = normalizePlantCode(String(row.office_id ?? ''));
        const zone = String(row.region_zone ?? '').trim();
        if (key && zone) map.set(key, zone);
      }
    });
  } catch (err) {
    console.warn(
      '[spare-loan-check] plant region map lookup failed:',
      err instanceof Error ? err.message : err
    );
  }
  return map;
}

/**
 * SAP plant code → CRM plant name + zone.
 * Zone prefers mis_plant_region_mappings; falls back to CRM mstzones via mstoffice.nzone.
 */
export async function lookupPlantMeta(
  plantCodes: string[]
): Promise<Map<string, PlantMeta>> {
  const unique = [...new Set(plantCodes.map(normalizePlantCode).filter((c) => c.length > 0))];
  if (unique.length === 0) return new Map();

  const [fromMap, fromOld] = await Promise.all([
    lookupZonesFromPlantMap(unique),
    lookupCrmFromOld(unique),
  ]);

  const needLive = unique.filter((c) => {
    const meta = fromOld.get(c);
    return !meta?.plantName || (!fromMap.has(c) && !meta.zone);
  });
  if (needLive.length > 0) {
    const fromLive = await lookupCrmFromLive(needLive);
    for (const [k, v] of fromLive) {
      const prev = fromOld.get(k);
      if (!prev) {
        fromOld.set(k, v);
        continue;
      }
      fromOld.set(k, {
        plantName: prev.plantName || v.plantName,
        zone: prev.zone || v.zone,
      });
    }
  }

  const out = new Map<string, PlantMeta>();
  for (const code of unique) {
    const crm = fromOld.get(code);
    out.set(code, {
      plantName: crm?.plantName ?? null,
      zone: fromMap.get(code) ?? crm?.zone ?? null,
    });
  }
  return out;
}

async function persistPlantMeta(byPlant: Map<string, PlantMeta>): Promise<void> {
  const entries = [...byPlant.entries()].filter(
    ([, m]) => m.plantName?.trim() || m.zone?.trim()
  );
  if (entries.length === 0) return;

  const plants = entries.map(([p]) => p);
  const names = entries.map(([, m]) => m.plantName?.trim() || null);
  const zones = entries.map(([, m]) => m.zone?.trim() || null);

  await withAppClient(async (client) => {
    await client.query(
      `
      UPDATE spare_loan_check_rows r
      SET
        plant_name = COALESCE(NULLIF(btrim(r.plant_name), ''), data.plant_name),
        zone = COALESCE(NULLIF(btrim(r.zone), ''), data.zone)
      FROM unnest($1::text[], $2::text[], $3::text[]) AS data(plant, plant_name, zone)
      WHERE r.plant = data.plant
        AND (
          r.plant_name IS NULL OR btrim(r.plant_name) = ''
          OR r.zone IS NULL OR btrim(r.zone) = ''
        )
      `,
      [plants, names, zones]
    );
  });
}

/** Fill blank plantName/zone on already-saved rows; persists hits for next load. */
export async function enrichMissingPlantMeta(
  rows: SpareLoanProblemRow[]
): Promise<SpareLoanProblemRow[]> {
  const need = rows.filter(
    (r) => r.plant?.trim() && (!r.plantName?.trim() || !r.zone?.trim())
  );
  if (need.length === 0) return rows;

  const map = await lookupPlantMeta(need.map((r) => r.plant));
  if (map.size === 0) return rows;

  void persistPlantMeta(map).catch((err) => {
    console.warn(
      '[spare-loan-check] plant meta persist skipped:',
      err instanceof Error ? err.message : err
    );
  });

  return rows.map((r) => {
    const meta = map.get(normalizePlantCode(r.plant));
    if (!meta) return r;
    return {
      ...r,
      plantName: r.plantName?.trim() || meta.plantName,
      zone: r.zone?.trim() || meta.zone,
    };
  });
}
