import { withAppClient } from '@/lib/read-model/db';
import {
  dedupeMb51Movements,
  mb51MovementDedupeKey,
} from '@/modules/mb51-aging/dedupe';
import { buildDefaultSnapshot } from '@/modules/mb51-aging/server/fifo-from-db';
import {
  enrichMb51VendorNames,
  loadSapVendorNameMap,
  normVendorCode,
} from '@/modules/mb51-aging/server/vendor-master';
import type {
  Mb51AgingImportMeta,
  Mb51AgingMovement,
} from '@/modules/mb51-aging/types';
import type { PoolClient } from 'pg';

async function withSapVendorNames(
  client: PoolClient,
  rows: Mb51AgingMovement[]
): Promise<Mb51AgingMovement[]> {
  if (!rows.length) return rows;
  const codes = rows.map((r) => normVendorCode(r.v)).filter(Boolean);
  if (!codes.length) return rows;
  try {
    const map = await loadSapVendorNameMap(client, codes);
    return enrichMb51VendorNames(rows, map);
  } catch (err) {
    // Table may not exist yet on older DBs — keep export names.
    console.warn('[mb51-aging] SAP vendor master lookup skipped', err);
    return rows;
  }
}

const BATCH_SIZE = 2_500;
const DAY = 86400000;
const EPOCH_OFFSET = 25569;
/** Large MB51 imports can exceed the default 120s API statement timeout. */
const SAVE_STATEMENT_TIMEOUT_MS = 300_000;
const LOAD_STATEMENT_TIMEOUT_MS = 300_000;

function serialToIsoDate(serial: number): string {
  try {
    const d = new Date(Math.round((serial - EPOCH_OFFSET) * DAY));
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toMeta(imp: {
  id: string;
  file_name: string;
  uploaded_by: string | null;
  row_count: number;
  plant_count: number;
  material_count: number;
  imported_at: Date;
}): Mb51AgingImportMeta {
  return {
    id: imp.id,
    fileName: imp.file_name,
    uploadedBy: imp.uploaded_by,
    rowCount: imp.row_count,
    plantCount: imp.plant_count,
    materialCount: imp.material_count,
    importedAt: imp.imported_at.toISOString(),
  };
}

async function loadExistingDedupeKeys(
  client: PoolClient,
  importId: string,
  rows: Mb51AgingMovement[]
): Promise<Set<string>> {
  const docs = [...new Set(rows.map((r) => r.dc ?? ''))];
  if (!docs.length) return new Set();

  const res = await client.query<{
    material_document: string;
    plant: string;
    material: string;
    movement_type: string;
    posting_date_serial: number;
    qty: string;
    vendor: string;
    uom: string;
    item_text: string;
  }>(
    `
    SELECT material_document, plant, material, movement_type,
           posting_date_serial, qty::text AS qty, vendor, uom, item_text
    FROM mb51_aging_rows
    WHERE import_id = $1
      AND material_document = ANY($2::text[])
    `,
    [importId, docs]
  );

  const keys = new Set<string>();
  for (const r of res.rows) {
    keys.add(
      mb51MovementDedupeKey({
        d: r.posting_date_serial,
        q: Number(r.qty),
        m: r.material,
        md: '',
        g: '',
        u: r.uom,
        v: r.vendor,
        vn: '',
        mv: r.plant,
        s: 0,
        dc: r.material_document,
        mt: r.movement_type,
        tx: r.item_text,
      })
    );
  }
  return keys;
}

/** Drop lines already stored on this import (append / overlapping Part2). */
async function filterNewRowsForImport(
  client: PoolClient,
  importId: string,
  rows: Mb51AgingMovement[]
): Promise<Mb51AgingMovement[]> {
  const { rows: unique } = dedupeMb51Movements(rows);
  if (!unique.length) return [];
  const existing = await loadExistingDedupeKeys(client, importId, unique);
  if (!existing.size) return unique;
  return unique.filter((r) => !existing.has(mb51MovementDedupeKey(r)));
}

async function insertRowBatch(
  client: PoolClient,
  importId: string,
  rows: Mb51AgingMovement[],
  seqOffset: number
): Promise<number> {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i];
      const seq = seqOffset + offset + i;
      const isoDate = serialToIsoDate(row.d);

      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      values.push(
        importId,
        row.d,
        isoDate,
        row.q,
        row.m ?? '',
        row.md ?? '',
        row.g ?? '',
        row.u ?? '',
        row.v ?? '',
        row.vn ?? '',
        row.mv ?? '',
        row.dc ?? '',
        row.mt ?? '',
        row.mtx ?? '',
        row.tx ?? '',
        seq
      );
    }

    if (placeholders.length > 0) {
      await client.query(
        `
        INSERT INTO mb51_aging_rows (
          import_id,
          posting_date_serial,
          posting_date,
          qty,
          material,
          material_description,
          material_group,
          uom,
          vendor,
          vendor_name,
          plant,
          material_document,
          movement_type,
          movement_type_text,
          item_text,
          seq_order
        ) VALUES ${placeholders.join(',')}
        ON CONFLICT (
          import_id,
          material_document,
          plant,
          material,
          movement_type,
          posting_date_serial,
          qty,
          vendor,
          uom,
          item_text
        ) DO NOTHING
        `,
        values
      );
      inserted += chunk.length;
    }
  }
  return inserted;
}

async function countImportRows(client: PoolClient, importId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM mb51_aging_rows WHERE import_id = $1`,
    [importId]
  );
  return res.rows[0]?.n ?? 0;
}

async function fetchImportMeta(
  client: PoolClient,
  importId: string
): Promise<Mb51AgingImportMeta> {
  const res = await client.query<{
    id: string;
    file_name: string;
    uploaded_by: string | null;
    row_count: number;
    plant_count: number;
    material_count: number;
    imported_at: Date;
  }>(
    `
    SELECT id, file_name, uploaded_by, row_count, plant_count, material_count, imported_at
    FROM mb51_aging_imports
    WHERE id = $1
    `,
    [importId]
  );
  const imp = res.rows[0];
  if (!imp) throw new Error('MB51 import not found');
  return toMeta(imp);
}

const DEFAULT_PAGE = 40_000;
const MAX_PAGE = 80_000;

export type Mb51AgingPage = {
  latestImport: Mb51AgingImportMeta | null;
  rows: Mb51AgingMovement[];
  nextAfter: number;
  done: boolean;
};

/** One page of the latest import (seq_order cursor). Avoids ~350MB single JSON for multi‑M row files. */
export async function fetchLatestMb51AgingPage(opts?: {
  afterSeq?: number;
  limit?: number;
}): Promise<Mb51AgingPage> {
  const afterSeq = Number.isFinite(opts?.afterSeq) ? Number(opts?.afterSeq) : -1;
  const limit = Math.min(
    MAX_PAGE,
    Math.max(1, Math.floor(opts?.limit ?? DEFAULT_PAGE))
  );

  return withAppClient(
    async (client) => {
      const importRes = await client.query<{
        id: string;
        file_name: string;
        uploaded_by: string | null;
        row_count: number;
        plant_count: number;
        material_count: number;
        imported_at: Date;
      }>(
        `
      SELECT id, file_name, uploaded_by, row_count, plant_count, material_count, imported_at
      FROM mb51_aging_imports
      ORDER BY imported_at DESC
      LIMIT 1
      `
      );

      if (importRes.rows.length === 0) {
        return { latestImport: null, rows: [], nextAfter: afterSeq, done: true };
      }

      const latestImport = toMeta(importRes.rows[0]);

      const rowsRes = await client.query<{
        posting_date_serial: number;
        qty: string;
        material: string;
        material_description: string;
        material_group: string;
        uom: string;
        vendor: string;
        vendor_name: string;
        plant: string;
        material_document: string;
        movement_type: string;
        movement_type_text: string;
        item_text: string;
        seq_order: number;
      }>(
        `
      SELECT
        posting_date_serial,
        qty,
        material,
        material_description,
        material_group,
        uom,
        vendor,
        vendor_name,
        plant,
        material_document,
        movement_type,
        movement_type_text,
        item_text,
        seq_order
      FROM mb51_aging_rows
      WHERE import_id = $1
        AND seq_order > $2
      ORDER BY seq_order ASC
      LIMIT $3
      `,
        [latestImport.id, afterSeq, limit]
      );

      const rows: Mb51AgingMovement[] = rowsRes.rows.map((r) => ({
        d: r.posting_date_serial,
        q: Number(r.qty),
        m: r.material,
        md: r.material_description,
        g: r.material_group,
        u: r.uom,
        v: r.vendor,
        vn: r.vendor_name,
        mv: r.plant,
        dc: r.material_document,
        mt: r.movement_type,
        mtx: r.movement_type_text,
        tx: r.item_text,
        s: r.seq_order,
      }));

      const nextAfter = rows.length ? rows[rows.length - 1].s : afterSeq;
      return {
        latestImport,
        rows,
        nextAfter,
        done: rows.length < limit,
      };
    },
    { statementTimeoutMs: LOAD_STATEMENT_TIMEOUT_MS }
  );
}

/** @deprecated Prefer fetchLatestMb51AgingPage — full dump OOMs on multi‑M row imports. */
export async function fetchLatestMb51AgingData(): Promise<{
  latestImport: Mb51AgingImportMeta | null;
  rows: Mb51AgingMovement[];
}> {
  const rows: Mb51AgingMovement[] = [];
  let afterSeq = -1;
  let latestImport: Mb51AgingImportMeta | null = null;
  for (;;) {
    const page = await fetchLatestMb51AgingPage({ afterSeq, limit: DEFAULT_PAGE });
    latestImport = page.latestImport;
    rows.push(...page.rows);
    if (page.done) break;
    afterSeq = page.nextAfter;
  }
  return { latestImport, rows };
}

export async function saveMb51AgingImport(opts: {
  fileName: string;
  uploadedBy: string | null;
  rows: Mb51AgingMovement[];
  replaceExisting?: boolean;
  /** When set, append rows to an existing import (chunked upload). */
  importId?: string | null;
  seqOffset?: number;
  expectedTotal?: number;
  /**
   * When set by the client: true = last chunk (rebuild snapshot), false = mid chunk.
   * When omitted, fall back to seqOffset + rows.length vs expectedTotal.
   */
  finalize?: boolean;
}): Promise<Mb51AgingImportMeta> {
  const {
    fileName,
    uploadedBy,
    rows,
    replaceExisting = false,
    importId: existingImportId,
    seqOffset = 0,
    expectedTotal,
    finalize: finalizeOpt,
  } = opts;

  let finalizeImportId: string | null = null;

  const meta = await withAppClient(
    async (client) => {
      async function refreshImportCounts(id: string, rowCount: number, finalize: boolean) {
        if (finalize) {
          await client.query(
            `
            UPDATE mb51_aging_imports
            SET row_count = $2,
                plant_count = (
                  SELECT count(DISTINCT NULLIF(plant, '')) FROM mb51_aging_rows WHERE import_id = $1
                ),
                material_count = (
                  SELECT count(DISTINCT NULLIF(material, '')) FROM mb51_aging_rows WHERE import_id = $1
                )
            WHERE id = $1
            `,
            [id, rowCount]
          );
          return;
        }
        await client.query(
          `UPDATE mb51_aging_imports SET row_count = $2 WHERE id = $1`,
          [id, rowCount]
        );
      }

      // Append chunk to an in-progress import (or append another file onto selected import).
      if (existingImportId) {
        await client.query('BEGIN');
        try {
          const exists = await client.query<{ id: string }>(
            `SELECT id FROM mb51_aging_imports WHERE id = $1`,
            [existingImportId]
          );
          if (!exists.rows[0]) {
            throw new Error(`MB51 import ${existingImportId} not found for append`);
          }
          const fresh = await withSapVendorNames(
            client,
            await filterNewRowsForImport(client, existingImportId, rows)
          );
          if (fresh.length) {
            // Use client seqOffset so parallel chunks don't collide on seq_order.
            await insertRowBatch(client, existingImportId, fresh, seqOffset);
          }
          // Keep a readable label when a later file is appended onto prior data.
          if (fileName) {
            await client.query(
              `
              UPDATE mb51_aging_imports
              SET file_name = CASE
                WHEN file_name = $2 OR file_name LIKE $2 || ' (%' THEN file_name
                WHEN position($2 in file_name) > 0 THEN file_name
                ELSE $2 || ' (+prior)'
              END
              WHERE id = $1
              `,
              [existingImportId, fileName]
            );
          }
          const chunkEnd = seqOffset + rows.length;
          const done =
            typeof finalizeOpt === 'boolean'
              ? finalizeOpt
              : expectedTotal != null && chunkEnd >= expectedTotal;
          const actual = await countImportRows(client, existingImportId);
          await refreshImportCounts(existingImportId, actual, done);
          if (done) finalizeImportId = existingImportId;
          await client.query('COMMIT');
          return await fetchImportMeta(client, existingImportId);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }

      await client.query('BEGIN');
      try {
        // Destructive wipe is opt-in only (CLI --replace). UI uploads must never wipe.
        if (replaceExisting) {
          await client.query('DELETE FROM mb51_aging_imports');
        }

        const { rows: deduped } = dedupeMb51Movements(rows);
        const uniqueRows = await withSapVendorNames(client, deduped);
        const plantCount = new Set(uniqueRows.map((r) => r.mv).filter(Boolean)).size;
        const materialCount = new Set(uniqueRows.map((r) => r.m).filter(Boolean)).size;

        const ins = await client.query<{ id: string; imported_at: Date }>(
          `
        INSERT INTO mb51_aging_imports (
          file_name, uploaded_by, row_count, plant_count, material_count
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, imported_at
        `,
          [fileName, uploadedBy, uniqueRows.length, plantCount, materialCount]
        );

        const importId = ins.rows[0]?.id;
        if (!importId) throw new Error('Failed to create MB51 import');

        await insertRowBatch(client, importId, uniqueRows, seqOffset);
        const chunkEnd = seqOffset + rows.length;
        const done =
          typeof finalizeOpt === 'boolean'
            ? finalizeOpt
            : expectedTotal == null || chunkEnd >= expectedTotal;
        const actual = await countImportRows(client, importId);
        await refreshImportCounts(importId, actual, done);
        if (done) finalizeImportId = importId;

        await client.query('COMMIT');
        return await fetchImportMeta(client, importId);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: SAVE_STATEMENT_TIMEOUT_MS }
  );

  // Materialize default FIFO snapshot after import is complete (fast page open).
  if (finalizeImportId) {
    try {
      await buildDefaultSnapshot(finalizeImportId);
    } catch (err) {
      console.error('[mb51-aging] default snapshot build failed', err);
    }
  }

  return meta;
}
