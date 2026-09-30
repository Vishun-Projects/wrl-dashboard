import {
  lookupItemCategoriesByMaterial,
  normalizeMaterialCode,
} from '@/lib/read-model/crm-masters';
import { withAppClient } from '@/lib/read-model/db';
import type { SpareLoanProblemRow } from '@/modules/spare-loan-check/types';

export { lookupItemCategoriesByMaterial, normalizeMaterialCode };

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
 * Fill blank itemCategory on already-saved rows.
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
