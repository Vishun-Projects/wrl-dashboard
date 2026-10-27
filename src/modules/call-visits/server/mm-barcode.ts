import type { PoolClient } from 'pg';
import { withAppClient } from '@/lib/read-model/db';

export type DocMaterialKey = { doc: string; material: string };

export type MmBarcodeLookup = {
  barcodesFor(keys: DocMaterialKey[]): string | null;
  mismatch(crmBarcode: string | null | undefined, sapBarcodes: string | null): boolean;
};

function normBarcode(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function partCodeKey(material: string): string {
  return material.trim().replace(/^0+/, '');
}

function mapKey(doc: string, material: string): string {
  return `${doc.trim()}|${partCodeKey(material)}`;
}

/** Latest MM barcode import → (material_document|material) → object descriptions. */
export async function loadMmBarcodeLookup(client: PoolClient): Promise<MmBarcodeLookup> {
  const byKey = new Map<string, Set<string>>();
  const res = await client.query<{
    material_document: string;
    material: string;
    object_description: string;
  }>(
    `SELECT btrim(r.material_document) AS material_document,
            regexp_replace(btrim(r.material), '^0+', '') AS material,
            btrim(r.object_description) AS object_description
     FROM mm_doc_barcode_rows r
     WHERE r.import_id = (SELECT id FROM mm_doc_barcode_imports ORDER BY imported_at DESC LIMIT 1)
       AND btrim(r.material_document) <> ''
       AND btrim(r.object_description) <> ''`
  );
  for (const row of res.rows) {
    const key = mapKey(row.material_document, row.material);
    let set = byKey.get(key);
    if (!set) {
      set = new Set();
      byKey.set(key, set);
    }
    set.add(row.object_description);
  }

  return {
    barcodesFor(keys) {
      const out = new Set<string>();
      for (const { doc, material } of keys) {
        if (!doc.trim() || !material.trim()) continue;
        const set = byKey.get(mapKey(doc, material));
        if (!set) continue;
        for (const bc of set) out.add(bc);
      }
      if (out.size === 0) return null;
      return [...out].sort().join(', ');
    },
    mismatch(crmBarcode, sapBarcodes) {
      if (!sapBarcodes?.trim()) return false;
      const crm = normBarcode(crmBarcode);
      const sapSet = new Set(
        sapBarcodes
          .split(',')
          .map((s) => normBarcode(s))
          .filter(Boolean)
      );
      if (sapSet.size === 0) return false;
      if (!crm) return true;
      return !sapSet.has(crm);
    },
  };
}

export async function loadMmBarcodeLookupStandalone(): Promise<MmBarcodeLookup> {
  return withAppClient((client) => loadMmBarcodeLookup(client));
}

/** Collect doc+material pairs from an aggregated docs string and materials. */
export function keysFromDocsAndMaterials(docs: string | null, materials: string[]): DocMaterialKey[] {
  if (!docs?.trim() || materials.length === 0) return [];
  const keys: DocMaterialKey[] = [];
  for (const doc of docs.split(',')) {
    const d = doc.trim();
    if (!d) continue;
    for (const material of materials) {
      const m = partCodeKey(material);
      if (!m) continue;
      keys.push({ doc: d, material: m });
    }
  }
  return keys;
}
