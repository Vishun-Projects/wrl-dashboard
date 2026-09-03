import { Client } from 'pg';
import { loadEnv } from '@/lib/read-model/db';

/** Strip leading zeros — same rule as SAP vs CRM stock reconciliation. */
export function normalizeMaterialCode(code: string): string {
  return code.replace(/^0+/, '').trim();
}

/**
 * Map SAP material codes → CRM mstitemcategory.vname via crm_raw.mstitems.
 * Uses OLD_CRM_DATABASE_URL (same DB as subcontractor stock recon).
 * Missing env / query errors → empty map (import still succeeds).
 */
export async function lookupItemCategoriesByMaterial(
  materialCodes: string[]
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      materialCodes.map(normalizeMaterialCode).filter((c) => c.length > 0)
    ),
  ];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL?.trim();
  if (!url) {
    console.warn(
      '[spare-loan-check] OLD_CRM_DATABASE_URL unset — item category lookup skipped'
    );
    return map;
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<{
      norm_code: string;
      item_category: string | null;
    }>(
      `
      SELECT
        regexp_replace(btrim(i.vitemcode), '^0+', '') AS norm_code,
        NULLIF(btrim(cat.vname), '') AS item_category
      FROM crm_raw.mstitems i
      LEFT JOIN crm_raw.mstitemcategory cat ON cat.ncode = i.nitemcategory
      WHERE i.vitemcode IS NOT NULL
        AND btrim(i.vitemcode) <> ''
        AND regexp_replace(btrim(i.vitemcode), '^0+', '') = ANY($1::text[])
      `,
      [unique]
    );

    for (const row of rows) {
      const key = String(row.norm_code ?? '').trim();
      const cat = row.item_category ? String(row.item_category).trim() : '';
      if (key && cat && !map.has(key)) map.set(key, cat);
    }
  } catch (err) {
    console.warn(
      '[spare-loan-check] item category lookup failed:',
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
