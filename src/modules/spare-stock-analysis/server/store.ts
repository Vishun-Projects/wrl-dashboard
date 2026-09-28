import { withAppClient } from '@/lib/read-model/db';
import { assignResolvedCalls, extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';
import { DEFECTIVE_COMPRESSOR_MATERIAL } from '@/modules/spare-stock-analysis/server/txn-type';
import type {
  DefectiveReturnResponse,
  SpareStockBreakdownRow,
  SpareStockDbDupesChoice,
  SpareStockDupPreviewRow,
  SpareStockImportPreview,
  SpareStockImportResponse,
  SpareStockInFileDupesChoice,
  SpareStockKpis,
  SpareStockLastImport,
  SpareStockMovementRow,
  SpareStockOptionsResponse,
  SpareStockParsedRow,
  SpareStockPartRow,
  SpareStockRowsResponse,
  SpareStockSummaryResponse,
  SpareStockTxnType,
} from '@/modules/spare-stock-analysis/types';

export type SpareStockDashFilters = {
  startDate: string;
  endDate: string;
  plants: string[];
  suppliers: string[];
  materials: string[];
  allowedPlants: string[] | null;
};

const KPI_SELECT = `
  COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type = 'opening' AND posting_date <= $END), 0)
    + COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type = 'receipt' AND posting_date < $START), 0)
    - COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type IN ('issued', 'consumption') AND posting_date < $START), 0)
    AS opening,
  COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type = 'receipt' AND posting_date BETWEEN $START AND $END), 0)
    AS received,
  COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type = 'issued' AND posting_date BETWEEN $START AND $END), 0)
    AS issued,
  COALESCE(SUM(ABS(qty)) FILTER (WHERE txn_type = 'consumption' AND posting_date BETWEEN $START AND $END), 0)
    AS consumption
`;

/** 2303393 COMPRESSOR (D) is tracked on the defective-returns report, not regular stock. */
const STOCK_EXCLUDE_DEFECTIVE = `AND material IS DISTINCT FROM '${DEFECTIVE_COMPRESSOR_MATERIAL}'`;

function num(v: unknown): number {
  return Number(v) || 0;
}

function toKpis(row: {
  opening?: unknown;
  received?: unknown;
  issued?: unknown;
  consumption?: unknown;
}): SpareStockKpis {
  const opening = num(row.opening);
  const received = num(row.received);
  const issued = num(row.issued);
  const consumption = num(row.consumption);
  return {
    opening,
    received,
    issued,
    consumption,
    closing: opening + received - issued - consumption,
  };
}

function buildScopeWhere(
  filters: Pick<SpareStockDashFilters, 'plants' | 'suppliers' | 'materials' | 'allowedPlants'>,
  startIdx = 1
): { sql: string; values: unknown[]; next: number } {
  const conds: string[] = ['1=1'];
  const values: unknown[] = [];
  let i = startIdx;
  if (filters.allowedPlants != null) {
    conds.push(`plant = ANY($${i++}::text[])`);
    values.push(filters.allowedPlants);
  }
  if (filters.plants.length) {
    conds.push(`plant = ANY($${i++}::text[])`);
    values.push(filters.plants);
  }
  if (filters.suppliers.length) {
    conds.push(`supplier = ANY($${i++}::text[])`);
    values.push(filters.suppliers);
  }
  if (filters.materials.length) {
    conds.push(`material = ANY($${i++}::text[])`);
    values.push(filters.materials);
  }
  return { sql: conds.join(' AND '), values, next: i };
}

function bindKpiSql(sql: string, startIdx: number): { sql: string; startPh: string; endPh: string } {
  const startPh = `$${startIdx}`;
  const endPh = `$${startIdx + 1}`;
  return {
    sql: sql.replaceAll('$START', startPh).replaceAll('$END', endPh),
    startPh,
    endPh,
  };
}

const INSERT_COLS = `
  row_key, import_id, plant, mat_doc, doc_date, posting_date, material, material_description,
  location, uom, qty, lc_amount, mvt, mvt_text, txn_type, batch, entry_date, entry_time,
  sap_user, material_group, customer, header_text, call_no, mat_yr, order_no, supplier
`;

type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

async function lookupRegisteredCallNos(
  client: Queryable,
  candidates: string[]
): Promise<Set<string>> {
  const uniq = [...new Set(candidates.map((c) => c.toUpperCase()))].filter(Boolean);
  if (!uniq.length) return new Set();
  const { rows } = await client.query<{ vtrnno: string }>(
    `SELECT vtrnno FROM calls_latest_hot WHERE UPPER(TRIM(vtrnno)) = ANY($1::text[])`,
    [uniq]
  );
  return new Set(rows.map((r) => String(r.vtrnno).trim().toUpperCase()));
}

async function writeResolvedCallNos(
  client: Queryable,
  rows: Array<{ row_key: string; plant: string; mat_doc: string | null; call_no: string | null }>
): Promise<void> {
  if (!rows.length) return;
  const inputs = rows.map((r) => ({
    plant: r.plant,
    matDoc: r.mat_doc ?? '',
    callNo: r.call_no ?? '',
  }));
  const candidates = [...new Set(inputs.flatMap((r) => extractCallNumbers(r.callNo)))];
  const registered = await lookupRegisteredCallNos(client, candidates);
  const assigned = assignResolvedCalls(inputs, registered);
  await client.query(
    `
    UPDATE spare_stock_movements m
    SET resolved_call_no = v.call
    FROM unnest($1::text[], $2::text[]) AS v(row_key, call)
    WHERE m.row_key = v.row_key
    `,
    [rows.map((r) => r.row_key), assigned]
  );
}

/** Assign extracted, register-checked calls when any row is still unresolved. */
async function ensureResolvedCallNos(client: Queryable): Promise<void> {
  const { rows: hit } = await client.query(
    `SELECT 1 FROM spare_stock_movements WHERE resolved_call_no IS NULL LIMIT 1`
  );
  if (!hit.length) return;
  const { rows } = await client.query<{
    row_key: string;
    plant: string;
    mat_doc: string | null;
    call_no: string | null;
  }>(
    `
    SELECT row_key, plant, mat_doc, call_no
    FROM spare_stock_movements
    ORDER BY plant, mat_doc, material, row_key
    `
  );
  await writeResolvedCallNos(client, rows);
}

const STAGING_DDL = `
CREATE TABLE IF NOT EXISTS spare_stock_import_uploads (
  upload_id             uuid PRIMARY KEY,
  file_name             text NOT NULL,
  uploaded_by           uuid,
  skipped               integer NOT NULL DEFAULT 0,
  parsed                integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spare_stock_import_staging (
  upload_id             uuid NOT NULL REFERENCES spare_stock_import_uploads(upload_id) ON DELETE CASCADE,
  seq                   integer NOT NULL,
  row_key               text NOT NULL,
  payload               jsonb NOT NULL,
  PRIMARY KEY (upload_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_spare_stock_import_staging_row_key
  ON spare_stock_import_staging (upload_id, row_key);
`;

const REPLACE_CONFLICT = `ON CONFLICT (row_key) DO UPDATE SET
  import_id = EXCLUDED.import_id,
  plant = EXCLUDED.plant,
  mat_doc = EXCLUDED.mat_doc,
  doc_date = EXCLUDED.doc_date,
  posting_date = EXCLUDED.posting_date,
  material = EXCLUDED.material,
  material_description = EXCLUDED.material_description,
  location = EXCLUDED.location,
  uom = EXCLUDED.uom,
  qty = EXCLUDED.qty,
  lc_amount = EXCLUDED.lc_amount,
  mvt = EXCLUDED.mvt,
  mvt_text = EXCLUDED.mvt_text,
  txn_type = EXCLUDED.txn_type,
  batch = EXCLUDED.batch,
  entry_date = EXCLUDED.entry_date,
  entry_time = EXCLUDED.entry_time,
  sap_user = EXCLUDED.sap_user,
  material_group = EXCLUDED.material_group,
  customer = EXCLUDED.customer,
  header_text = EXCLUDED.header_text,
  call_no = EXCLUDED.call_no,
  mat_yr = EXCLUDED.mat_yr,
  order_no = EXCLUDED.order_no,
  supplier = EXCLUDED.supplier`;

function movementSelectFromPayload(rowKeySql: string, importIdPh: string): string {
  return `
    ${rowKeySql},
    ${importIdPh},
    p.payload->>'plant',
    NULLIF(p.payload->>'matDoc', ''),
    NULLIF(p.payload->>'docDate', '')::date,
    (p.payload->>'postingDate')::date,
    NULLIF(p.payload->>'material', ''),
    NULLIF(p.payload->>'materialDescription', ''),
    NULLIF(p.payload->>'location', ''),
    NULLIF(p.payload->>'uom', ''),
    COALESCE((p.payload->>'qty')::numeric, 0),
    (p.payload->>'lcAmount')::numeric,
    p.payload->>'mvt',
    NULLIF(p.payload->>'mvtText', ''),
    p.payload->>'txnType',
    NULLIF(p.payload->>'batch', ''),
    NULLIF(p.payload->>'entryDate', '')::date,
    NULLIF(p.payload->>'entryTime', ''),
    NULLIF(p.payload->>'sapUser', ''),
    NULLIF(p.payload->>'materialGroup', ''),
    NULLIF(p.payload->>'customer', ''),
    NULLIF(p.payload->>'headerText', ''),
    NULLIF(p.payload->>'callNo', ''),
    NULLIF(p.payload->>'matYr', ''),
    NULLIF(p.payload->>'orderNo', ''),
    NULLIF(p.payload->>'supplier', '')
  `;
}

function dupPreviewFromPayload(payload: Record<string, unknown>, copies: number): SpareStockDupPreviewRow {
  return {
    plant: String(payload.plant ?? ''),
    postingDate: String(payload.postingDate ?? ''),
    matDoc: String(payload.matDoc ?? ''),
    material: String(payload.material ?? ''),
    materialDescription: String(payload.materialDescription ?? ''),
    qty: Number(payload.qty) || 0,
    mvt: String(payload.mvt ?? ''),
    supplier: String(payload.supplier ?? ''),
    callNo: String(payload.callNo ?? ''),
    copies,
  };
}

async function ensureStaging(client: Queryable): Promise<void> {
  for (const sql of STAGING_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await client.query(sql);
  }
}

export async function purgeStaleSpareStockStaging(): Promise<void> {
  await withAppClient(async (client) => {
    await ensureStaging(client);
    await client.query(
      `DELETE FROM spare_stock_import_uploads WHERE created_at < now() - interval '24 hours'`
    );
  });
}

export async function abortSpareStockStaging(uploadId: string): Promise<void> {
  await withAppClient(async (client) => {
    await ensureStaging(client);
    await client.query(`DELETE FROM spare_stock_import_uploads WHERE upload_id = $1`, [uploadId]);
  });
}

export async function insertSpareStockStagingRows(params: {
  uploadId: string;
  fileName: string;
  uploadedBy: string | null;
  rows: SpareStockParsedRow[];
  skippedDelta: number;
}): Promise<{ parsed: number; skipped: number }> {
  const { uploadId, fileName, uploadedBy, rows, skippedDelta } = params;
  return withAppClient(async (client) => {
    await ensureStaging(client);
    await client.query(
      `
      INSERT INTO spare_stock_import_uploads (upload_id, file_name, uploaded_by, skipped, parsed)
      VALUES ($1, $2, $3, 0, 0)
      ON CONFLICT (upload_id) DO NOTHING
      `,
      [uploadId, fileName, uploadedBy]
    );

    const { rows: maxRows } = await client.query<{ n: string }>(
      `SELECT COALESCE(MAX(seq), 0)::text AS n FROM spare_stock_import_staging WHERE upload_id = $1`,
      [uploadId]
    );
    let seq = Number(maxRows[0]?.n) || 0;
    if (rows.length) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let i = 1;
      for (const r of rows) {
        seq += 1;
        placeholders.push(`($${i++}::uuid, $${i++}::int, $${i++}::text, $${i++}::jsonb)`);
        values.push(uploadId, seq, r.rowKey, JSON.stringify(r));
      }
      await client.query(
        `
        INSERT INTO spare_stock_import_staging (upload_id, seq, row_key, payload)
        VALUES ${placeholders.join(',')}
        `,
        values
      );
    }

    const { rows: totals } = await client.query<{ parsed: string; skipped: string }>(
      `
      UPDATE spare_stock_import_uploads
      SET parsed = parsed + $2, skipped = skipped + $3
      WHERE upload_id = $1
      RETURNING parsed::text, skipped::text
      `,
      [uploadId, rows.length, skippedDelta]
    );
    return {
      parsed: Number(totals[0]?.parsed) || 0,
      skipped: Number(totals[0]?.skipped) || 0,
    };
  });
}

export async function previewSpareStockStaging(uploadId: string): Promise<SpareStockImportPreview> {
  return withAppClient(async (client) => {
    await ensureStaging(client);
    const { rows: sessions } = await client.query<{
      file_name: string;
      parsed: number;
      skipped: number;
    }>(
      `SELECT file_name, parsed, skipped FROM spare_stock_import_uploads WHERE upload_id = $1`,
      [uploadId]
    );
    const session = sessions[0];
    if (!session) throw new Error('Upload session expired. Parse the file again.');

    const [extraRes, inFileRes, inDbCountRes, inDbSampleRes, distinctRes] = await Promise.all([
      client.query<{ extra: string }>(
        `
        SELECT (COUNT(*) - COUNT(DISTINCT row_key))::text AS extra
        FROM spare_stock_import_staging
        WHERE upload_id = $1
        `,
        [uploadId]
      ),
      client.query<{ copies: string; payload: Record<string, unknown> }>(
        `
        SELECT COUNT(*)::text AS copies, (array_agg(payload ORDER BY seq))[1] AS payload
        FROM spare_stock_import_staging
        WHERE upload_id = $1
        GROUP BY row_key
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
        LIMIT 40
        `,
        [uploadId]
      ),
      client.query<{ n: string }>(
        `
        SELECT COUNT(DISTINCT s.row_key)::text AS n
        FROM spare_stock_import_staging s
        JOIN spare_stock_movements m ON m.row_key = s.row_key
        WHERE s.upload_id = $1
        `,
        [uploadId]
      ),
      client.query<{ copies: string; payload: Record<string, unknown> }>(
        `
        SELECT 1::text AS copies, s.payload
        FROM spare_stock_import_staging s
        JOIN spare_stock_movements m ON m.row_key = s.row_key
        WHERE s.upload_id = $1
        ORDER BY s.seq
        LIMIT 40
        `,
        [uploadId]
      ),
      client.query<{ n: string }>(
        `
        SELECT COUNT(DISTINCT row_key)::text AS n
        FROM spare_stock_import_staging
        WHERE upload_id = $1
        `,
        [uploadId]
      ),
    ]);

    const extraCount = Number(extraRes.rows[0]?.extra) || 0;
    const inDbCount = Number(inDbCountRes.rows[0]?.n) || 0;
    const distinct = Number(distinctRes.rows[0]?.n) || 0;

    return {
      kind: 'preview',
      fileName: session.file_name,
      parsed: Number(session.parsed) || 0,
      skipped: Number(session.skipped) || 0,
      newCount: distinct - inDbCount,
      inFile: {
        extraCount,
        groups: inFileRes.rows.map((r) => dupPreviewFromPayload(r.payload, Number(r.copies) || 0)),
      },
      inDb: {
        count: inDbCount,
        groups: inDbSampleRes.rows.map((r) => dupPreviewFromPayload(r.payload, 1)),
      },
    };
  });
}

export async function importSpareStockFromStaging(params: {
  uploadId: string;
  uploadedBy: string | null;
  inFileDupes: SpareStockInFileDupesChoice;
  dbDupes: SpareStockDbDupesChoice;
}): Promise<SpareStockImportResponse> {
  const { uploadId, uploadedBy, inFileDupes, dbDupes } = params;

  return withAppClient(async (client) => {
    await ensureStaging(client);
    await client.query('BEGIN');
    try {
      const { rows: sessions } = await client.query<{
        file_name: string;
        parsed: number;
        skipped: number;
      }>(
        `SELECT file_name, parsed, skipped FROM spare_stock_import_uploads WHERE upload_id = $1 FOR UPDATE`,
        [uploadId]
      );
      const session = sessions[0];
      if (!session) throw new Error('Upload session expired. Parse the file again.');

      const { rows: stats } = await client.query<{ extras: string; db_hits: string }>(
        `
        WITH firsts AS (
          SELECT DISTINCT ON (row_key) row_key
          FROM spare_stock_import_staging
          WHERE upload_id = $1
          ORDER BY row_key, seq
        )
        SELECT
          (SELECT (COUNT(*) - COUNT(DISTINCT row_key))::text FROM spare_stock_import_staging WHERE upload_id = $1) AS extras,
          (
            SELECT COUNT(*)::text FROM firsts f
            JOIN spare_stock_movements m ON m.row_key = f.row_key
          ) AS db_hits
        `,
        [uploadId]
      );
      const extras = Number(stats[0]?.extras) || 0;
      const dbHits = Number(stats[0]?.db_hits) || 0;

      const ins = await client.query<{ id: string }>(
        `
        INSERT INTO spare_stock_imports (file_name, uploaded_by, parsed, inserted, duplicates, skipped)
        VALUES ($1, $2, $3, 0, 0, $4)
        RETURNING id
        `,
        [session.file_name, uploadedBy, session.parsed, session.skipped]
      );
      const importId = ins.rows[0]?.id;
      if (!importId) throw new Error('Failed to create import row');

      const numbered = `
        WITH p AS (
          SELECT payload, row_key, ROW_NUMBER() OVER (PARTITION BY row_key ORDER BY seq) AS rn
          FROM spare_stock_import_staging
          WHERE upload_id = $1
        )
      `;

      const fresh = await client.query(
        `
        ${numbered}
        INSERT INTO spare_stock_movements (${INSERT_COLS})
        SELECT ${movementSelectFromPayload('p.row_key', '$2')}
        FROM p
        WHERE p.rn = 1
          AND NOT EXISTS (SELECT 1 FROM spare_stock_movements m WHERE m.row_key = p.row_key)
        ON CONFLICT (row_key) DO NOTHING
        `,
        [uploadId, importId]
      );

      let extraInserted = 0;
      if (inFileDupes === 'import') {
        const extraRes = await client.query(
          `
          ${numbered}
          INSERT INTO spare_stock_movements (${INSERT_COLS})
          SELECT ${movementSelectFromPayload(`p.row_key || '#' || p.rn::text`, '$2')}
          FROM p
          WHERE p.rn > 1
          ON CONFLICT (row_key) DO NOTHING
          `,
          [uploadId, importId]
        );
        extraInserted = extraRes.rowCount ?? 0;
      }

      let replaced = 0;
      if (dbDupes === 'replace') {
        const rep = await client.query(
          `
          ${numbered}
          INSERT INTO spare_stock_movements (${INSERT_COLS})
          SELECT ${movementSelectFromPayload('p.row_key', '$2')}
          FROM p
          WHERE p.rn = 1
            AND EXISTS (SELECT 1 FROM spare_stock_movements m WHERE m.row_key = p.row_key)
          ${REPLACE_CONFLICT}
          `,
          [uploadId, importId]
        );
        replaced = rep.rowCount ?? 0;
      }

      let kept = 0;
      if (dbDupes === 'keep') {
        const keepRes = await client.query(
          `
          ${numbered}
          INSERT INTO spare_stock_movements (${INSERT_COLS})
          SELECT ${movementSelectFromPayload(`p.row_key || '#2'`, '$2')}
          FROM p
          WHERE p.rn = 1
            AND EXISTS (SELECT 1 FROM spare_stock_movements m WHERE m.row_key = p.row_key)
          ON CONFLICT (row_key) DO NOTHING
          `,
          [uploadId, importId]
        );
        kept = keepRes.rowCount ?? 0;
      }

      await ensureResolvedCallNos(client);
      const dbSkipped = dbDupes === 'skip' ? dbHits : 0;
      const inFileImported = inFileDupes === 'import' ? extraInserted : 0;
      const duplicates = (inFileDupes === 'skip' ? extras : 0) + dbSkipped;
      const inserted = (fresh.rowCount ?? 0) + extraInserted + replaced + kept;

      await client.query(
        `
        UPDATE spare_stock_imports
        SET inserted = $2, duplicates = $3
        WHERE id = $1
        `,
        [importId, inserted, duplicates]
      );
      await client.query(`DELETE FROM spare_stock_import_uploads WHERE upload_id = $1`, [uploadId]);
      await client.query('COMMIT');
      return {
        kind: 'imported',
        parsed: Number(session.parsed) || 0,
        inserted,
        duplicates,
        skipped: Number(session.skipped) || 0,
        fileName: session.file_name,
        inFileImported,
        dbSkipped,
        dbReplaced: replaced,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

function mapLastImport(r: {
  file_name: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  imported_at: Date;
} | undefined): SpareStockLastImport | null {
  if (!r) return null;
  return {
    fileName: r.file_name,
    parsed: Number(r.parsed) || 0,
    inserted: Number(r.inserted) || 0,
    duplicates: Number(r.duplicates) || 0,
    skipped: Number(r.skipped) || 0,
    importedAt: r.imported_at.toISOString(),
  };
}

export async function fetchSpareStockOptions(
  allowedPlants: string[] | null
): Promise<SpareStockOptionsResponse> {
  return withAppClient(async (client) => {
    const restrict = allowedPlants != null;
    const plantClause = restrict ? 'WHERE plant = ANY($1::text[])' : '';
    const params = restrict ? [allowedPlants] : [];

    const [plants, suppliers, materials] = await Promise.all([
      client.query<{ plant: string }>(
        `
        SELECT DISTINCT plant
        FROM spare_stock_movements
        ${plantClause}
        ORDER BY plant
        `,
        params
      ),
      client.query<{ supplier: string }>(
        `
        SELECT DISTINCT supplier
        FROM spare_stock_movements
        ${plantClause}
        ${restrict ? 'AND' : 'WHERE'} supplier IS NOT NULL AND supplier <> ''
        ORDER BY supplier
        `,
        params
      ),
      client.query<{ material: string; material_description: string | null }>(
        `
        SELECT material, MIN(material_description) AS material_description
        FROM spare_stock_movements
        ${plantClause}
        ${restrict ? 'AND' : 'WHERE'} material IS NOT NULL AND material <> ''
        GROUP BY material
        ORDER BY material
        `,
        params
      ),
    ]);

    return {
      plants: plants.rows.map((r) => r.plant),
      suppliers: suppliers.rows.map((r) => r.supplier),
      materials: materials.rows.map((r) => ({
        value: r.material,
        label: r.material_description ? `${r.material} — ${r.material_description}` : r.material,
      })),
    };
  });
}

export async function fetchSpareStockSummary(
  filters: SpareStockDashFilters
): Promise<SpareStockSummaryResponse> {
  const scope = buildScopeWhere(filters, 3);
  const kpi = bindKpiSql(KPI_SELECT, 1);

  return withAppClient(async (client) => {
    await ensureResolvedCallNos(client);
    const kpiValues = [filters.startDate, filters.endDate, ...scope.values];

    const [kpiRes, topRes, branchRes, franchiseeRes, lastRes] = await Promise.all([
      client.query<{ opening: string; received: string; issued: string; consumption: string }>(
        `
        SELECT ${kpi.sql}
        FROM spare_stock_movements
        WHERE ${scope.sql}
          ${STOCK_EXCLUDE_DEFECTIVE}
        `,
        kpiValues
      ),
      client.query<{ material: string; material_description: string | null; qty: string }>(
        `
        SELECT material, MIN(material_description) AS material_description, SUM(ABS(qty)) AS qty
        FROM spare_stock_movements
        WHERE ${scope.sql}
          ${STOCK_EXCLUDE_DEFECTIVE}
          AND txn_type = 'consumption'
          AND posting_date BETWEEN $1 AND $2
        GROUP BY material
        ORDER BY SUM(ABS(qty)) DESC
        LIMIT 20
        `,
        kpiValues
      ),
      client.query<{
        plant: string;
        opening: string;
        received: string;
        issued: string;
        consumption: string;
      }>(
        `
        SELECT plant, ${kpi.sql}
        FROM spare_stock_movements
        WHERE ${scope.sql}
          ${STOCK_EXCLUDE_DEFECTIVE}
        GROUP BY plant
        ORDER BY plant
        `,
        kpiValues
      ),
      client.query<{
        supplier: string;
        opening: string;
        received: string;
        issued: string;
        consumption: string;
      }>(
        `
        SELECT COALESCE(NULLIF(supplier, ''), '(blank)') AS supplier, ${kpi.sql}
        FROM spare_stock_movements
        WHERE ${scope.sql}
          ${STOCK_EXCLUDE_DEFECTIVE}
        GROUP BY COALESCE(NULLIF(supplier, ''), '(blank)')
        ORDER BY 1
        `,
        kpiValues
      ),
      client.query<{
        file_name: string;
        parsed: number;
        inserted: number;
        duplicates: number;
        skipped: number;
        imported_at: Date;
      }>(
        `
        SELECT file_name, parsed, inserted, duplicates, skipped, imported_at
        FROM spare_stock_imports
        ORDER BY imported_at DESC
        LIMIT 1
        `
      ),
    ]);

    const mapBreakdown = (
      key: string,
      label: string,
      row: { opening?: unknown; received?: unknown; issued?: unknown; consumption?: unknown }
    ): SpareStockBreakdownRow => ({
      key,
      label,
      ...toKpis(row),
    });

    return {
      kpis: toKpis(kpiRes.rows[0] ?? {}),
      topConsumption: topRes.rows.map(
        (r): SpareStockPartRow => ({
          material: r.material,
          materialDescription: r.material_description ?? '',
          qty: num(r.qty),
        })
      ),
      byBranch: branchRes.rows.map((r) => mapBreakdown(r.plant, r.plant, r)),
      byFranchisee: franchiseeRes.rows.map((r) => mapBreakdown(r.supplier, r.supplier, r)),
      lastImport: mapLastImport(lastRes.rows[0]),
    };
  });
}

export async function fetchSpareStockRows(
  filters: SpareStockDashFilters & { page: number; pageSize: number }
): Promise<SpareStockRowsResponse> {
  const scope = buildScopeWhere(filters, 3);
  const offset = (filters.page - 1) * filters.pageSize;
  const values = [filters.startDate, filters.endDate, ...scope.values, filters.pageSize, offset];
  const limitPh = `$${scope.next}`;
  const offsetPh = `$${scope.next + 1}`;

  return withAppClient(async (client) => {
    await ensureResolvedCallNos(client);
    const countRes = await client.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM spare_stock_movements
      WHERE ${scope.sql}
        AND posting_date BETWEEN $1 AND $2
      `,
      [filters.startDate, filters.endDate, ...scope.values]
    );
    const { rows } = await client.query<{
      plant: string;
      posting_date: Date;
      mat_doc: string | null;
      material: string | null;
      material_description: string | null;
      qty: string;
      mvt: string;
      txn_type: string;
      supplier: string | null;
      call_no: string | null;
    }>(
      `
      SELECT plant, posting_date, mat_doc, material, material_description, qty, mvt, txn_type, supplier,
             NULLIF(TRIM(resolved_call_no), '') AS call_no
      FROM spare_stock_movements
      WHERE ${scope.sql}
        AND posting_date BETWEEN $1 AND $2
      ORDER BY posting_date DESC, mat_doc DESC, material
      LIMIT ${limitPh} OFFSET ${offsetPh}
      `,
      values
    );

    return {
      rows: rows.map(
        (r): SpareStockMovementRow => ({
          plant: r.plant,
          postingDate:
            r.posting_date instanceof Date
              ? r.posting_date.toISOString().slice(0, 10)
              : String(r.posting_date).slice(0, 10),
          matDoc: r.mat_doc ?? '',
          material: r.material ?? '',
          materialDescription: r.material_description ?? '',
          qty: num(r.qty),
          mvt: r.mvt,
          txnType: r.txn_type as SpareStockTxnType,
          supplier: r.supplier ?? '',
          callNo: r.call_no ?? '',
        })
      ),
      total: Number(countRes.rows[0]?.n) || 0,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}

const CALL_KEY = `COALESCE(NULLIF(TRIM(resolved_call_no), ''), '(no call)')`;
const SUPPLIER_KEY = `COALESCE(NULLIF(supplier, ''), '(blank)')`;

/** Compressor consumption vs 2303393 defective receipts, matched on call number. */
export async function fetchDefectiveCompressorReport(
  filters: SpareStockDashFilters
): Promise<DefectiveReturnResponse> {
  const scope = buildScopeWhere({ ...filters, materials: [] }, 3);
  const values = [filters.startDate, filters.endDate, ...scope.values];

  return withAppClient(async (client) => {
    await ensureResolvedCallNos(client);
    const { rows } = await client.query<{
      plant: string;
      call_no: string;
      supplier: string;
      material: string | null;
      material_description: string | null;
      consumed: string;
      received: string;
    }>(
      `
      WITH cons AS (
        SELECT
          plant,
          ${CALL_KEY} AS call_no,
          ${SUPPLIER_KEY} AS supplier,
          SUM(ABS(qty)) AS consumed,
          MIN(material) AS material,
          MIN(material_description) AS material_description
        FROM spare_stock_movements
        WHERE ${scope.sql}
          AND txn_type = 'consumption'
          AND material IS DISTINCT FROM '${DEFECTIVE_COMPRESSOR_MATERIAL}'
          AND material_group ILIKE 'COMPRES%'
          AND posting_date BETWEEN $1 AND $2
        GROUP BY plant, ${CALL_KEY}, ${SUPPLIER_KEY}
      ),
      recv AS (
        SELECT
          plant,
          ${CALL_KEY} AS call_no,
          ${SUPPLIER_KEY} AS supplier,
          SUM(ABS(qty)) AS received
        FROM spare_stock_movements
        WHERE ${scope.sql}
          AND material = '${DEFECTIVE_COMPRESSOR_MATERIAL}'
          AND txn_type = 'receipt'
          AND posting_date BETWEEN $1 AND $2
        GROUP BY plant, ${CALL_KEY}, ${SUPPLIER_KEY}
      )
      SELECT
        COALESCE(c.plant, r.plant) AS plant,
        COALESCE(c.call_no, r.call_no) AS call_no,
        COALESCE(c.supplier, r.supplier) AS supplier,
        COALESCE(c.material, '') AS material,
        COALESCE(c.material_description, '') AS material_description,
        COALESCE(c.consumed, 0) AS consumed,
        COALESCE(r.received, 0) AS received
      FROM cons c
      FULL OUTER JOIN recv r
        ON c.plant = r.plant AND c.call_no = r.call_no AND c.supplier = r.supplier
      ORDER BY (COALESCE(c.consumed, 0) - COALESCE(r.received, 0)) DESC, call_no
      `,
      values
    );

    const mapped = rows.map((r) => {
      const consumed = num(r.consumed);
      const received = num(r.received);
      return {
        plant: r.plant,
        callNo: r.call_no,
        supplier: r.supplier,
        material: r.material ?? '',
        materialDescription: r.material_description ?? '',
        consumed,
        received,
        outstanding: consumed - received,
      };
    });

    const kpis = mapped.reduce(
      (acc, r) => {
        acc.consumed += r.consumed;
        acc.received += r.received;
        acc.outstanding += r.outstanding;
        return acc;
      },
      { consumed: 0, received: 0, outstanding: 0 }
    );

    const byFr = new Map<string, { consumed: number; received: number; outstanding: number }>();
    for (const r of mapped) {
      const cur = byFr.get(r.supplier) ?? { consumed: 0, received: 0, outstanding: 0 };
      cur.consumed += r.consumed;
      cur.received += r.received;
      cur.outstanding += r.outstanding;
      byFr.set(r.supplier, cur);
    }

    return {
      kpis,
      rows: mapped,
      byFranchisee: [...byFr.entries()]
        .map(([supplier, v]) => ({ supplier, ...v }))
        .sort((a, b) => b.outstanding - a.outstanding),
    };
  });
}
