import type pg from 'pg';
import { postQuery } from '@/lib/db/proxy';
import { withAppClient, withTransaction } from '@/lib/read-model/db';

const ITEM_BATCH = 2500;
const QUERY_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

export type CrmMastersRefreshResult = {
  categories: number;
  repairs: number;
  items: number;
};

function normMaterial(code: string): string {
  return code.trim().replace(/^0+/, '');
}

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function isActiveFlag(raw: unknown): boolean {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return s === '' || s === 'true' || s === '1' || s === 'yes';
}

function isMajorFlag(raw: unknown): boolean {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

async function postRaw(sql: string): Promise<Record<string, unknown>[]> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await postQuery({ rawSql: sql, timeoutMs: QUERY_TIMEOUT_MS });
      return (res.data ?? []) as Record<string, unknown>[];
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw lastErr ?? new Error('CRM master fetch failed');
}

async function fetchCategories(): Promise<
  Array<{ ncode: string; vname: string; vshortname: string; bactive: boolean }>
> {
  const rows = await postRaw(`
SELECT
  LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) AS ncode,
  LTRIM(RTRIM(vname)) AS vname,
  LTRIM(RTRIM(vshortname)) AS vshortname,
  LTRIM(RTRIM(CAST(bactive AS VARCHAR(20)))) AS bactive
FROM mstitemcategory (NOLOCK)
WHERE ncode IS NOT NULL
  AND LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) <> ''
  AND LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) <> '0'
`);
  const out: Array<{ ncode: string; vname: string; vshortname: string; bactive: boolean }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ncode = cell(row, 'ncode');
    if (!ncode || seen.has(ncode)) continue;
    seen.add(ncode);
    out.push({
      ncode,
      vname: cell(row, 'vname'),
      vshortname: cell(row, 'vshortname'),
      bactive: isActiveFlag(row.bactive),
    });
  }
  return out;
}

async function fetchRepairs(): Promise<
  Array<{
    ncode: string;
    vname: string;
    vshortname: string;
    bactive: boolean;
    bmajor: boolean;
  }>
> {
  const rows = await postRaw(`
SELECT
  LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) AS ncode,
  LTRIM(RTRIM(vname)) AS vname,
  LTRIM(RTRIM(vshortname)) AS vshortname,
  LTRIM(RTRIM(CAST(bactive AS VARCHAR(20)))) AS bactive,
  LTRIM(RTRIM(CAST(bmajor AS VARCHAR(20)))) AS bmajor
FROM mstrepair (NOLOCK)
WHERE ncode IS NOT NULL
  AND LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) <> ''
  AND LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) <> '0'
`);
  const out: Array<{
    ncode: string;
    vname: string;
    vshortname: string;
    bactive: boolean;
    bmajor: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ncode = cell(row, 'ncode');
    if (!ncode || seen.has(ncode)) continue;
    seen.add(ncode);
    out.push({
      ncode,
      vname: cell(row, 'vname'),
      vshortname: cell(row, 'vshortname'),
      bactive: isActiveFlag(row.bactive),
      bmajor: isMajorFlag(row.bmajor),
    });
  }
  return out;
}

async function fetchItemsAfter(
  afterNcode: number
): Promise<
  Array<{
    ncode: string;
    vitemcode: string;
    norm_vitemcode: string;
    vname: string;
    nitemtype: string;
    nitemcategory: string;
    bactive: boolean;
  }>
> {
  const rows = await postRaw(`
SELECT TOP ${ITEM_BATCH}
  LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))) AS ncode,
  LTRIM(RTRIM(vitemcode)) AS vitemcode,
  LTRIM(RTRIM(vname)) AS vname,
  LTRIM(RTRIM(CAST(nitemtype AS VARCHAR(50)))) AS nitemtype,
  LTRIM(RTRIM(CAST(nitemcategory AS VARCHAR(50)))) AS nitemcategory,
  LTRIM(RTRIM(CAST(bactive AS VARCHAR(20)))) AS bactive
FROM mstitems (NOLOCK)
WHERE TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))), '') AS BIGINT) > ${afterNcode}
ORDER BY TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))), '') AS BIGINT)
`);
  const out: Array<{
    ncode: string;
    vitemcode: string;
    norm_vitemcode: string;
    vname: string;
    nitemtype: string;
    nitemcategory: string;
    bactive: boolean;
  }> = [];
  for (const row of rows) {
    const ncode = cell(row, 'ncode');
    if (!ncode) continue;
    const vitemcode = cell(row, 'vitemcode');
    out.push({
      ncode,
      vitemcode,
      norm_vitemcode: normMaterial(vitemcode),
      vname: cell(row, 'vname'),
      nitemtype: cell(row, 'nitemtype'),
      nitemcategory: cell(row, 'nitemcategory'),
      bactive: isActiveFlag(row.bactive),
    });
  }
  return out;
}

async function batchUpsert(
  client: pg.PoolClient,
  sql: string,
  rows: unknown[][],
  batchSize = 200
): Promise<void> {
  if (rows.length === 0) return;
  const cols = rows[0]!.length;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, ri) => {
      const off = ri * cols;
      placeholders.push(`(${row.map((_, ci) => `$${off + ci + 1}`).join(', ')})`);
      values.push(...row);
    });
    await client.query(`${sql} VALUES ${placeholders.join(', ')}`, values);
  }
}

async function markOk(client: pg.PoolClient, entity: string): Promise<void> {
  await client.query(
    `UPDATE sync_state
     SET status = 'ok', is_running = false, last_run_at = now()
     WHERE entity = $1`,
    [entity]
  );
}

/**
 * Full refresh of CRM item / category / repair masters into Postgres.
 * Categories + repairs are small; items page by ncode (CRM viewstate limit).
 */
export async function refreshCrmMasters(): Promise<CrmMastersRefreshResult> {
  const syncedAt = new Date();
  const [categories, repairs] = await Promise.all([fetchCategories(), fetchRepairs()]);

  const itemRows: Array<{
    ncode: string;
    vitemcode: string;
    norm_vitemcode: string;
    vname: string;
    nitemtype: string;
    nitemcategory: string;
    bactive: boolean;
  }> = [];
  let after = 0;
  for (;;) {
    const batch = await fetchItemsAfter(after);
    if (batch.length === 0) break;
    itemRows.push(...batch);
    const last = Number(batch[batch.length - 1]!.ncode);
    if (!Number.isFinite(last) || last <= after) break;
    after = last;
    if (batch.length < ITEM_BATCH) break;
  }

  await withTransaction(async (client) => {
    await client.query(`TRUNCATE crm_mstitemcategory, crm_mstrepair, crm_mstitems`);

    await batchUpsert(
      client,
      `INSERT INTO crm_mstitemcategory (ncode, vname, vshortname, bactive, synced_at)`,
      categories.map((r) => [r.ncode, r.vname || null, r.vshortname || null, r.bactive, syncedAt])
    );
    await batchUpsert(
      client,
      `INSERT INTO crm_mstrepair (ncode, vname, vshortname, bactive, bmajor, synced_at)`,
      repairs.map((r) => [
        r.ncode,
        r.vname || null,
        r.vshortname || null,
        r.bactive,
        r.bmajor,
        syncedAt,
      ])
    );
    await batchUpsert(
      client,
      `INSERT INTO crm_mstitems (
          ncode, vitemcode, norm_vitemcode, vname, nitemtype, nitemcategory, bactive, synced_at
        )`,
      itemRows.map((r) => [
        r.ncode,
        r.vitemcode || null,
        r.norm_vitemcode || null,
        r.vname || null,
        r.nitemtype || null,
        r.nitemcategory || null,
        r.bactive,
        syncedAt,
      ]),
      300
    );

    await markOk(client, 'crm_mstitemcategory');
    await markOk(client, 'crm_mstrepair');
    await markOk(client, 'crm_mstitems');
  });

  return {
    categories: categories.length,
    repairs: repairs.length,
    items: itemRows.length,
  };
}

export async function countCrmMstItems(): Promise<number> {
  return withAppClient(async (client) => {
    try {
      const { rows } = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM crm_mstitems`
      );
      return Number(rows[0]?.n) || 0;
    } catch {
      return 0;
    }
  });
}

/** Same rule as SAP vs CRM stock / ZSS02 material match. */
export function normalizeMaterialCode(code: string): string {
  return normMaterial(code);
}

/**
 * Material code → mstitemcategory display name.
 * Single app path for item groups / categories — do not query live CRM or old_crm for this.
 */
export async function lookupItemCategoriesByMaterial(
  materialCodes: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(materialCodes.map(normMaterial).filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  return withAppClient(async (client) => {
    try {
      const { rows } = await client.query<{
        norm_vitemcode: string;
        item_category: string | null;
      }>(
        `
        SELECT DISTINCT ON (i.norm_vitemcode)
          i.norm_vitemcode,
          COALESCE(NULLIF(btrim(c.vname), ''), NULLIF(btrim(c.vshortname), '')) AS item_category
        FROM crm_mstitems i
        LEFT JOIN crm_mstitemcategory c ON c.ncode = i.nitemcategory
        WHERE i.norm_vitemcode = ANY($1::text[])
        ORDER BY i.norm_vitemcode, i.bactive DESC, i.ncode
        `,
        [unique]
      );
      for (const row of rows) {
        const key = String(row.norm_vitemcode ?? '').trim();
        const cat = row.item_category ? String(row.item_category).trim() : '';
        if (key && cat) map.set(key, cat);
      }
    } catch (err) {
      console.warn(
        '[crm-masters] item category lookup failed:',
        err instanceof Error ? err.message : err
      );
    }
    return map;
  });
}

/** ncode → category display name (ARCP / filters). */
export async function loadItemCategoryLabelsByCode(): Promise<Record<string, string>> {
  return withAppClient(async (client) => {
    try {
      const { rows } = await client.query<{ code: string; label: string }>(`
        SELECT
          ncode AS code,
          COALESCE(NULLIF(btrim(vname), ''), NULLIF(btrim(vshortname), '')) AS label
        FROM crm_mstitemcategory
        WHERE ncode IS NOT NULL AND btrim(ncode) <> ''
      `);
      const map: Record<string, string> = {};
      for (const row of rows) {
        const code = String(row.code ?? '').trim();
        const label = String(row.label ?? '').trim();
        if (code && label) map[code] = label;
      }
      return map;
    } catch {
      return {};
    }
  });
}

export type CrmRepairMasterRow = { ncode: string; vname: string };

/** Active repair types (Serial Audit / Warranty exceptions / register picker). */
export async function listRepairMaster(): Promise<CrmRepairMasterRow[]> {
  return withAppClient(async (client) => {
    try {
      const { rows } = await client.query<{ ncode: string; vname: string }>(`
        SELECT ncode, vname
        FROM crm_mstrepair
        WHERE bactive = true
          AND NULLIF(btrim(vname), '') IS NOT NULL
        ORDER BY vname
      `);
      const byName = new Map<string, CrmRepairMasterRow>();
      for (const row of rows) {
        const ncode = String(row.ncode ?? '').trim();
        const vname = String(row.vname ?? '').trim();
        if (!ncode || !vname) continue;
        const key = vname.toLowerCase();
        if (!byName.has(key)) byName.set(key, { ncode, vname });
      }
      return [...byName.values()];
    } catch (err) {
      console.warn(
        '[crm-masters] repair master list failed:',
        err instanceof Error ? err.message : err
      );
      return [];
    }
  });
}

export type CrmMaterialMeta = { code: string; name: string };

/** Distinct materials for settings pickers (was old_crm mstitems). */
export async function listActiveMaterials(): Promise<CrmMaterialMeta[]> {
  return withAppClient(async (client) => {
    try {
      const { rows } = await client.query<{ code: string; name: string }>(`
        SELECT DISTINCT ON (norm_vitemcode)
          COALESCE(NULLIF(btrim(vitemcode), ''), norm_vitemcode) AS code,
          COALESCE(NULLIF(btrim(vname), ''), '') AS name
        FROM crm_mstitems
        WHERE bactive = true
          AND norm_vitemcode IS NOT NULL AND btrim(norm_vitemcode) <> ''
        ORDER BY norm_vitemcode, ncode
      `);
      return rows
        .map((r) => ({
          code: String(r.code ?? '').trim(),
          name: String(r.name ?? '').trim(),
        }))
        .filter((r) => r.code);
    } catch (err) {
      console.warn(
        '[crm-masters] materials list failed:',
        err instanceof Error ? err.message : err
      );
      return [];
    }
  });
}
