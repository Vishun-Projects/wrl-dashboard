import { Client } from 'pg';
import { postQuery } from '@/lib/db/proxy';
import { loadEnv, withAppClient } from '@/lib/read-model/db';
import type { SpareLoanProblemRow } from '@/modules/spare-loan-check/types';

/** Strip leading zeros — same rule as SAP vs CRM stock reconciliation. */
export function normalizeMaterialCode(code: string): string {
  return code.replace(/^0+/, '').trim();
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

const CRM_CHUNK = 80;

async function lookupFromOldCrm(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  loadEnv();
  const url = process.env.OLD_CRM_DATABASE_URL?.trim();
  if (!url) return map;

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
      [codes]
    );

    for (const row of rows) {
      const key = String(row.norm_code ?? '').trim();
      const cat = row.item_category ? String(row.item_category).trim() : '';
      if (key && cat && !map.has(key)) map.set(key, cat);
    }
  } catch (err) {
    console.warn(
      '[spare-loan-check] old_crm item category lookup failed:',
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

/** Live CRM fallback when old_crm mirror is unset / unreachable (VPS Next often lacks OLD_CRM). */
async function lookupFromLiveCrm(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < codes.length; i += CRM_CHUNK) {
    const chunk = codes.slice(i, i + CRM_CHUNK);
    const inList = chunk.map((c) => `'${escapeSqlLiteral(c)}'`).join(',');
    try {
      const res = await postQuery({
        rawSql: `
SELECT
  LTRIM(RTRIM(i.vitemcode)) AS vitemcode,
  LTRIM(RTRIM(cat.vname)) AS item_category
FROM mstitems i (NOLOCK)
LEFT JOIN mstitemcategory cat (NOLOCK)
  ON CAST(cat.ncode AS VARCHAR(50)) = CAST(i.nitemcategory AS VARCHAR(50))
WHERE LTRIM(RTRIM(i.vitemcode)) IN (${inList})
`,
        timeoutMs: 60_000,
      });
      for (const row of res.data ?? []) {
        const key = normalizeMaterialCode(String(row.vitemcode ?? ''));
        const cat = String(row.item_category ?? '').trim();
        if (key && cat && !map.has(key)) map.set(key, cat);
      }
    } catch (err) {
      console.warn(
        '[spare-loan-check] live CRM item category chunk failed:',
        err instanceof Error ? err.message : err
      );
      break;
    }
  }
  return map;
}

/**
 * Map SAP material codes → CRM mstitemcategory.vname via mstitems.
 * Prefer old_crm (same as SAP vs CRM stock); fall back to live CRM.
 */
export async function lookupItemCategoriesByMaterial(
  materialCodes: string[]
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      materialCodes.map(normalizeMaterialCode).filter((c) => c.length > 0)
    ),
  ];
  if (unique.length === 0) return new Map();

  const fromOld = await lookupFromOldCrm(unique);
  if (fromOld.size >= unique.length) return fromOld;

  const missing = unique.filter((c) => !fromOld.has(c));
  if (missing.length === 0) return fromOld;

  const fromLive = await lookupFromLiveCrm(missing);
  for (const [k, v] of fromLive) {
    if (!fromOld.has(k)) fromOld.set(k, v);
  }
  return fromOld;
}

async function persistItemCategories(byNormMaterial: Map<string, string>): Promise<void> {
  const entries = [...byNormMaterial.entries()];
  if (entries.length === 0) return;
  const norms = entries.map(([n]) => n);
  const cats = entries.map(([, c]) => c);

  await withAppClient(async (client) => {
    await client.query(
      `
      UPDATE spare_loan_check_rows r
      SET item_category = data.item_category
      FROM unnest($1::text[], $2::text[]) AS data(norm_material, item_category)
      WHERE regexp_replace(btrim(COALESCE(r.material, '')), '^0+', '') = data.norm_material
        AND (r.item_category IS NULL OR btrim(r.item_category) = '')
      `,
      [norms, cats]
    );
  });
}

/**
 * Fill blank itemCategory on already-saved rows (e.g. imports done without OLD_CRM).
 * Persists hits so the next load stays fast.
 */
export async function enrichMissingItemCategories(
  rows: SpareLoanProblemRow[]
): Promise<SpareLoanProblemRow[]> {
  const need = rows.filter((r) => !r.itemCategory?.trim() && r.material?.trim());
  if (need.length === 0) return rows;

  const map = await lookupItemCategoriesByMaterial(need.map((r) => r.material));
  if (map.size === 0) return rows;

  void persistItemCategories(map).catch((err) => {
    console.warn(
      '[spare-loan-check] item category persist skipped:',
      err instanceof Error ? err.message : err
    );
  });

  return rows.map((r) => {
    if (r.itemCategory?.trim()) return r;
    const cat = map.get(normalizeMaterialCode(r.material)) ?? null;
    return cat ? { ...r, itemCategory: cat } : r;
  });
}
