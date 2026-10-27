import type { PoolClient } from 'pg';
import { withBulkReadClient } from '@/lib/read-model/db';
import { DEFAULT_DEFECTIVE_MATERIALS } from '@/modules/mb51-aging/fifo';
import {
  keysFromDocsAndMaterials,
  loadMmBarcodeLookup,
  type MmBarcodeLookup,
} from '@/modules/call-visits/server/mm-barcode';

/** Defective SAP materials excluded from MB51 aging. Latest MB51 import only. */
const DEFECTIVE_MATERIALS = [...DEFAULT_DEFECTIVE_MATERIALS];

/**
 * MB51 movement matrix (non-defective vs defective material codes):
 * Consumption → SAP doc (non-defective only): 947, 943, 944, 948, 702, 309
 * Defective Generation → SAP doc (Defective): 947, 943, 944, 948
 * Defective Receipt → SAP doc (Defective Receipt): 941, 949, 952, 942, 951, 301, 302, 541
 */
const CONSUMPTION_MOVEMENTS = ['947', '943', '944', '948', '702', '309'];
const DEFECTIVE_GENERATION_MOVEMENTS = ['947', '943', '944', '948'];
const DEFECTIVE_RECEIPT_MOVEMENTS = ['941', '949', '952', '942', '951', '301', '302', '541'];

function sqlList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(',');
}

export type SapDocPart = {
  callNo: string | null;
  plantName: string | null;
  franchiseeCode: string | null;
  partCategory: string | null;
  partCode: string | null;
  newBarcode?: string | null;
  oldBarcode?: string | null;
};

export type SapDocPair = {
  sapDoc: string | null;
  /** Earliest consumption MB51 posting_date (YYYY-MM-DD). */
  sapDocPostingDate: string | null;
  sapDocDefective: string | null;
  sapDocDefectiveQty: string | null;
  sapDocDefectiveReceipt: string | null;
  sapDocDefectiveReceiptQty: string | null;
  sapDocBarcode: string | null;
  sapDocBarcodeMismatch: boolean;
  sapDocDefectiveBarcode: string | null;
  sapDocDefectiveBarcodeMismatch: boolean;
  sapDocDefectiveReceiptBarcode: string | null;
  sapDocDefectiveReceiptBarcodeMismatch: boolean;
};

/** Days = consumption posting date − techSolve visit date. Null if either side missing. */
export function daysDiffTechSolveCons(
  visitAt: string | null | undefined,
  postingDate: string | null | undefined
): number | null {
  const visit = (visitAt ?? '').trim().slice(0, 10);
  const post = (postingDate ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visit) || !/^\d{4}-\d{2}-\d{2}$/.test(post)) return null;
  const a = Date.parse(`${visit}T00:00:00Z`);
  const b = Date.parse(`${post}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

type SapDocHit = {
  callNo: string;
  plant: string;
  vendor: string;
  material: string;
  description: string;
  docs: string | null;
  qty: number | string | null;
  /** Earliest MB51 posting_date in the grouped hit (YYYY-MM-DD). */
  postingDate?: string | null;
};

export type DefectiveMatch = { docs: string | null; qty: string | null; materials: string[] };

export type SapDocLookup = {
  match(part: SapDocPart): SapDocPair;
};

export function hasSapBarcodeMismatch(m: SapDocPair): boolean {
  return (
    m.sapDocBarcodeMismatch ||
    m.sapDocDefectiveBarcodeMismatch ||
    m.sapDocDefectiveReceiptBarcodeMismatch
  );
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function plantCode(branchName: string | null): string {
  return (branchName ?? '').trim().match(/^[0-9]+/)?.[0] ?? '';
}

function partCodeKey(partCode: string | null): string {
  return (partCode ?? '').trim().replace(/^0+/, '');
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function hitQty(hit: SapDocHit): number {
  const n = typeof hit.qty === 'number' ? hit.qty : Number(hit.qty);
  return Number.isFinite(n) ? n : 0;
}

/** COMPRESSOR (D) / MOTOR (D) are the defective twins of those CRM item categories. */
function familyFromDescription(description: string): 'MOTOR' | 'COMPRESOR' | null {
  const label = description.trim().toUpperCase();
  if (label.startsWith('COMPRESSOR') || label.startsWith('COMPRESOR')) return 'COMPRESOR';
  if (label.startsWith('MOTOR')) return 'MOTOR';
  return null;
}

function familyFromCategory(category: string | null): 'MOTOR' | 'COMPRESOR' | null {
  const label = norm(category);
  if (label === 'COMPRESSOR' || label === 'COMPRESOR') return 'COMPRESOR';
  if (label === 'MOTOR') return 'MOTOR';
  return null;
}

function hitPostingYmd(hit: SapDocHit): string | null {
  const raw = (hit.postingDate ?? '').toString().trim();
  return raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function collectDocs(
  hits: SapDocHit[],
  keep: (hit: SapDocHit) => boolean
): { docs: string | null; materials: string[]; postingDate: string | null } {
  const docs = new Set<string>();
  const materials = new Set<string>();
  let postingDate: string | null = null;
  for (const hit of hits) {
    if (!keep(hit)) continue;
    if (hit.material) materials.add(hit.material);
    const pd = hitPostingYmd(hit);
    if (pd && (postingDate == null || pd < postingDate)) postingDate = pd;
    for (const doc of (hit.docs ?? '').split(',')) {
      const trimmed = doc.trim();
      if (trimmed) docs.add(trimmed);
    }
  }
  return {
    docs: docs.size === 0 ? null : [...docs].sort().join(', '),
    materials: [...materials],
    postingDate,
  };
}

function collectDefective(hits: SapDocHit[], keep: (hit: SapDocHit) => boolean): DefectiveMatch {
  const docs = new Set<string>();
  const materials = new Set<string>();
  let qty = 0;
  let matched = false;
  for (const hit of hits) {
    if (!keep(hit)) continue;
    matched = true;
    qty += hitQty(hit);
    if (hit.material) materials.add(hit.material);
    for (const doc of (hit.docs ?? '').split(',')) {
      const trimmed = doc.trim();
      if (trimmed) docs.add(trimmed);
    }
  }
  if (!matched) return { docs: null, qty: null, materials: [] };
  return {
    docs: docs.size === 0 ? null : [...docs].sort().join(', '),
    qty: formatQty(qty),
    materials: [...materials],
  };
}

function defectiveKeep(part: SapDocPart, vendor: string): ((hit: SapDocHit) => boolean) | null {
  const callNo = norm(part.callNo);
  const plant = plantCode(part.plantName);
  const vendorKey = vendor.trim();
  if (!callNo || !plant || !vendorKey) return null;
  const family = familyFromCategory(part.partCategory);
  const code = partCodeKey(part.partCode);
  return (hit) =>
    hit.callNo === callNo &&
    hit.plant === plant &&
    hit.vendor === vendorKey &&
    ((code !== '' && code === hit.material) ||
      (family != null && family === familyFromDescription(hit.description)));
}

/** Defective materials / (D) family match on plant + vendor + call. */
export function matchSapDocDefective(part: SapDocPart, vendor: string, hits: SapDocHit[]): DefectiveMatch {
  const keep = defectiveKeep(part, vendor);
  if (!keep) return { docs: null, qty: null, materials: [] };
  return collectDefective(hits, keep);
}

/** Consumption movements for non-defective materials, matched by part code. */
export function matchSapDocOriginal(
  part: SapDocPart,
  vendor: string,
  hits: SapDocHit[]
): { docs: string | null; materials: string[]; postingDate: string | null } {
  const callNo = norm(part.callNo);
  const plant = plantCode(part.plantName);
  const vendorKey = vendor.trim();
  const code = partCodeKey(part.partCode);
  if (!callNo || !plant || !vendorKey || !code) return { docs: null, materials: [], postingDate: null };
  return collectDocs(
    hits,
    (hit) => hit.callNo === callNo && hit.plant === plant && hit.vendor === vendorKey && hit.material === code
  );
}

function indexByCall(hits: SapDocHit[]): Map<string, SapDocHit[]> {
  const map = new Map<string, SapDocHit[]>();
  for (const hit of hits) {
    const list = map.get(hit.callNo);
    if (list) list.push(hit);
    else map.set(hit.callNo, [hit]);
  }
  return map;
}

const EMPTY_PAIR: SapDocPair = {
  sapDoc: null,
  sapDocPostingDate: null,
  sapDocDefective: null,
  sapDocDefectiveQty: null,
  sapDocDefectiveReceipt: null,
  sapDocDefectiveReceiptQty: null,
  sapDocBarcode: null,
  sapDocBarcodeMismatch: false,
  sapDocDefectiveBarcode: null,
  sapDocDefectiveBarcodeMismatch: false,
  sapDocDefectiveReceiptBarcode: null,
  sapDocDefectiveReceiptBarcodeMismatch: false,
};

function emptyMmLookup(): MmBarcodeLookup {
  return {
    barcodesFor: () => null,
    mismatch: () => false,
  };
}

function enrichWithBarcodes(
  part: SapDocPart,
  docs: {
    sapDoc: string | null;
    sapDocPostingDate: string | null;
    sapDocMaterials: string[];
    sapDocDefective: string | null;
    sapDocDefectiveQty: string | null;
    sapDocDefectiveMaterials: string[];
    sapDocDefectiveReceipt: string | null;
    sapDocDefectiveReceiptQty: string | null;
    sapDocDefectiveReceiptMaterials: string[];
  },
  mm: MmBarcodeLookup
): SapDocPair {
  const sapDocBarcode = mm.barcodesFor(keysFromDocsAndMaterials(docs.sapDoc, docs.sapDocMaterials));
  const sapDocDefectiveBarcode = mm.barcodesFor(
    keysFromDocsAndMaterials(docs.sapDocDefective, docs.sapDocDefectiveMaterials)
  );
  const sapDocDefectiveReceiptBarcode = mm.barcodesFor(
    keysFromDocsAndMaterials(docs.sapDocDefectiveReceipt, docs.sapDocDefectiveReceiptMaterials)
  );
  return {
    sapDoc: docs.sapDoc,
    sapDocPostingDate: docs.sapDocPostingDate,
    sapDocDefective: docs.sapDocDefective,
    sapDocDefectiveQty: docs.sapDocDefectiveQty,
    sapDocDefectiveReceipt: docs.sapDocDefectiveReceipt,
    sapDocDefectiveReceiptQty: docs.sapDocDefectiveReceiptQty,
    sapDocBarcode,
    sapDocBarcodeMismatch: mm.mismatch(part.newBarcode, sapDocBarcode),
    sapDocDefectiveBarcode,
    sapDocDefectiveBarcodeMismatch: mm.mismatch(part.oldBarcode, sapDocDefectiveBarcode),
    sapDocDefectiveReceiptBarcode,
    sapDocDefectiveReceiptBarcodeMismatch: mm.mismatch(part.oldBarcode, sapDocDefectiveReceiptBarcode),
  };
}

function buildLookup(
  vendors: Map<string, string>,
  generationByCall: Map<string, SapDocHit[]>,
  receiptByCall: Map<string, SapDocHit[]>,
  consumptionByCall: Map<string, SapDocHit[]>,
  mm: MmBarcodeLookup
): SapDocLookup {
  return {
    match(part) {
      const call = norm(part.callNo);
      if (!call) return EMPTY_PAIR;
      const vendor = vendors.get((part.franchiseeCode ?? '').trim()) ?? '';
      const generation = matchSapDocDefective(part, vendor, generationByCall.get(call) ?? []);
      const receipt = matchSapDocDefective(part, vendor, receiptByCall.get(call) ?? []);
      const consumption = matchSapDocOriginal(part, vendor, consumptionByCall.get(call) ?? []);
      return enrichWithBarcodes(
        part,
        {
          sapDoc: consumption.docs,
          sapDocPostingDate: consumption.postingDate,
          sapDocMaterials: consumption.materials,
          sapDocDefective: generation.docs,
          sapDocDefectiveQty: generation.qty,
          sapDocDefectiveMaterials: generation.materials,
          sapDocDefectiveReceipt: receipt.docs,
          sapDocDefectiveReceiptQty: receipt.qty,
          sapDocDefectiveReceiptMaterials: receipt.materials,
        },
        mm
      );
    },
  };
}

async function loadAllOfficeVendors(client: PoolClient): Promise<Map<string, string>> {
  const vendors = new Map<string, string>();
  const officeRes = await client.query<{ code: string; vendor: string | null }>(
    `SELECT ncode::text AS code, NULLIF(btrim(vsapvendorcode), '') AS vendor
     FROM dim_offices
     WHERE NULLIF(btrim(vsapvendorcode), '') IS NOT NULL`
  );
  for (const row of officeRes.rows) {
    if (row.vendor) vendors.set(row.code, row.vendor);
  }
  return vendors;
}

const HIT_SELECT = `SELECT upper(btrim(r.item_text)) AS "callNo",
            btrim(r.plant) AS plant,
            btrim(r.vendor) AS vendor,
            regexp_replace(btrim(r.material), '^0+', '') AS material,
            btrim(r.material_description) AS description,
            string_agg(DISTINCT NULLIF(btrim(r.material_document), ''), ', ') AS docs,
            coalesce(sum(r.qty), 0) AS qty,
            to_char(min(r.posting_date), 'YYYY-MM-DD') AS "postingDate"
     FROM mb51_aging_rows r`;

const LATEST_IMPORT = `(SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1)`;

/**
 * One-shot MB51 + office + MM barcode preload for CSV export.
 * Avoids re-querying mb51_aging_rows on every page.
 */
export async function loadSapDocLookup(client: PoolClient): Promise<SapDocLookup> {
  const vendors = await loadAllOfficeVendors(client);

  // Sequential: one pg client cannot run parallel queries.
  const generationRes = await client.query<SapDocHit>(
    `${HIT_SELECT}
     WHERE r.import_id = ${LATEST_IMPORT}
       AND btrim(r.movement_type) IN (${sqlList(DEFECTIVE_GENERATION_MOVEMENTS)})
       AND r.material IN (${sqlList(DEFECTIVE_MATERIALS)})
       AND btrim(r.item_text) <> ''
     GROUP BY 1, 2, 3, 4, 5`
  );
  const receiptRes = await client.query<SapDocHit>(
    `${HIT_SELECT}
     WHERE r.import_id = ${LATEST_IMPORT}
       AND btrim(r.movement_type) IN (${sqlList(DEFECTIVE_RECEIPT_MOVEMENTS)})
       AND r.material IN (${sqlList(DEFECTIVE_MATERIALS)})
       AND btrim(r.item_text) <> ''
     GROUP BY 1, 2, 3, 4, 5`
  );
  const consumptionRes = await client.query<SapDocHit>(
    `${HIT_SELECT}
     WHERE r.import_id = ${LATEST_IMPORT}
       AND btrim(r.movement_type) IN (${sqlList(CONSUMPTION_MOVEMENTS)})
       AND r.material NOT IN (${sqlList(DEFECTIVE_MATERIALS)})
       AND upper(btrim(r.material_description)) NOT LIKE '%(D)%'
       AND btrim(r.item_text) <> ''
     GROUP BY 1, 2, 3, 4, 5`
  );

  let mm: MmBarcodeLookup = emptyMmLookup();
  try {
    mm = await loadMmBarcodeLookup(client);
  } catch {
    /* ignore */
  }

  return buildLookup(
    vendors,
    indexByCall(generationRes.rows),
    indexByCall(receiptRes.rows),
    indexByCall(consumptionRes.rows),
    mm
  );
}

/** Consumption + defective generation/receipt SAP documents for each part line. */
export async function sapDocsForParts(
  rows: SapDocPart[],
  client?: PoolClient
): Promise<SapDocPair[]> {
  if (rows.length === 0) return [];
  const lookup = await getCachedSapDocLookup(client);
  return rows.map((row) => lookup.match(row));
}

type LookupCache = { token: string; lookup: SapDocLookup };
let lookupCache: LookupCache | null = null;
let lookupInflight: Promise<SapDocLookup> | null = null;

async function lookupCacheToken(client: PoolClient): Promise<string> {
  const res = await client.query<{ mb51: string | null; mm: string | null }>(
    `SELECT
       (SELECT id::text FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1) AS mb51,
       (SELECT id::text FROM mm_doc_barcode_imports ORDER BY imported_at DESC LIMIT 1) AS mm`
  );
  return `${res.rows[0]?.mb51 ?? ''}:${res.rows[0]?.mm ?? ''}`;
}

/** Latest cache token (mb51:mm import ids), or null before first load. */
export function sapDocLookupCacheToken(): string | null {
  return lookupCache?.token ?? null;
}

/**
 * Process-local MB51+MM lookup. First call pays preload; later filter/sort/page hits memory.
 * Tokened by latest import ids so a re-import refreshes automatically.
 */
export async function getCachedSapDocLookup(client?: PoolClient): Promise<SapDocLookup> {
  const load = async (c: PoolClient) => {
    let token: string;
    try {
      token = await lookupCacheToken(c);
    } catch {
      token = 'missing';
    }
    if (lookupCache?.token === token) return lookupCache.lookup;
    const lookup = await loadSapDocLookup(c);
    lookupCache = { token, lookup };
    return lookup;
  };

  if (client) return load(client);

  if (!lookupInflight) {
    lookupInflight = withBulkReadClient(load).finally(() => {
      lookupInflight = null;
    });
  }
  return lookupInflight;
}
