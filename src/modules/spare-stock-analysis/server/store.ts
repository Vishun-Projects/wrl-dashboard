import { withAppClient } from '@/lib/read-model/db';
import { assignResolvedCalls, extractCallNumbers } from '@/modules/spare-stock-analysis/server/call-no';
import { groupByRowKey, keyedCopy, toDupPreview } from '@/modules/spare-stock-analysis/server/import-classify';
import { DEFECTIVE_COMPRESSOR_MATERIAL } from '@/modules/spare-stock-analysis/server/txn-type';
import type {
  DefectiveReturnResponse,
  SpareStockBreakdownRow,
  SpareStockDbDupesChoice,
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

async function existingRowKeys(keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (keys.length === 0) return found;
  return withAppClient(async (client) => {
    const chunkSize = 1000;
    for (let offset = 0; offset < keys.length; offset += chunkSize) {
      const chunk = keys.slice(offset, offset + chunkSize);
      const { rows } = await client.query<{ row_key: string }>(
        `SELECT row_key FROM spare_stock_movements WHERE row_key = ANY($1::text[])`,
        [chunk]
      );
      for (const r of rows) found.add(r.row_key);
    }
    return found;
  });
}

export async function previewSpareStockImport(params: {
  fileName: string;
  rows: SpareStockParsedRow[];
  skipped: number;
}): Promise<SpareStockImportPreview> {
  const groups = groupByRowKey(params.rows);
  const firsts: SpareStockParsedRow[] = [];
  const inFileGroups = [];
  let extraCount = 0;
  for (const g of groups.values()) {
    firsts.push(g[0]);
    if (g.length > 1) {
      extraCount += g.length - 1;
      inFileGroups.push(toDupPreview(g[0], g.length));
    }
  }

  const existing = await existingRowKeys(firsts.map((r) => r.rowKey));
  const inDbGroups = firsts.filter((r) => existing.has(r.rowKey)).map((r) => toDupPreview(r, 1));

  return {
    kind: 'preview',
    fileName: params.fileName,
    parsed: params.rows.length,
    skipped: params.skipped,
    newCount: firsts.length - inDbGroups.length,
    inFile: { extraCount, groups: inFileGroups },
    inDb: { count: inDbGroups.length, groups: inDbGroups.slice(0, 40) },
  };
}

function rowValues(r: SpareStockParsedRow, importId: string): unknown[] {
  return [
    r.rowKey,
    importId,
    r.plant,
    r.matDoc || null,
    r.docDate,
    r.postingDate,
    r.material || null,
    r.materialDescription || null,
    r.location || null,
    r.uom || null,
    r.qty,
    r.lcAmount,
    r.mvt,
    r.mvtText || null,
    r.txnType,
    r.batch || null,
    r.entryDate,
    r.entryTime || null,
    r.sapUser || null,
    r.materialGroup || null,
    r.customer || null,
    r.headerText || null,
    r.callNo || null,
    r.matYr || null,
    r.orderNo || null,
    r.supplier || null,
  ];
}

async function insertMovementBatch(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rowCount?: number | null }> },
  importId: string,
  rows: SpareStockParsedRow[],
  onConflict: 'nothing' | 'replace'
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  const batchSize = 400;
  const conflictSql =
    onConflict === 'replace'
      ? `ON CONFLICT (row_key) DO UPDATE SET
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
          supplier = EXCLUDED.supplier`
      : 'ON CONFLICT (row_key) DO NOTHING';

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const chunk = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const r of chunk) {
      placeholders.push(
        `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
      );
      values.push(...rowValues(r, importId));
    }
    const res = await client.query(
      `
      INSERT INTO spare_stock_movements (${INSERT_COLS})
      VALUES ${placeholders.join(',')}
      ${conflictSql}
      `,
      values
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export async function importSpareStockMovements(params: {
  fileName: string;
  uploadedBy: string | null;
  rows: SpareStockParsedRow[];
  skipped: number;
  inFileDupes: SpareStockInFileDupesChoice;
  dbDupes: SpareStockDbDupesChoice;
}): Promise<SpareStockImportResponse> {
  const { fileName, uploadedBy, rows, skipped, inFileDupes, dbDupes } = params;
  const groups = groupByRowKey(rows);
  const firsts: SpareStockParsedRow[] = [];
  const extras: SpareStockParsedRow[] = [];
  for (const g of groups.values()) {
    firsts.push(g[0]);
    if (inFileDupes === 'import') {
      extras.push(...g.slice(1).map((row, i) => keyedCopy(row, i + 2)));
    }
  }

  const existing = await existingRowKeys(firsts.map((r) => r.rowKey));
  const fresh = firsts.filter((r) => !existing.has(r.rowKey));
  const dbHits = firsts.filter((r) => existing.has(r.rowKey));

  const toInsert: SpareStockParsedRow[] = [...fresh];
  if (inFileDupes === 'import') toInsert.push(...extras);

  const replaceRows = dbDupes === 'replace' ? dbHits : [];
  if (dbDupes === 'keep') {
    toInsert.push(...dbHits.map((r) => keyedCopy(r, 2)));
  }

  return withAppClient(async (client) => {
    await client.query('BEGIN');
    try {
      const ins = await client.query<{ id: string }>(
        `
        INSERT INTO spare_stock_imports (file_name, uploaded_by, parsed, inserted, duplicates, skipped)
        VALUES ($1, $2, $3, 0, 0, $4)
        RETURNING id
        `,
        [fileName, uploadedBy, rows.length, skipped]
      );
      const importId = ins.rows[0]?.id;
      if (!importId) throw new Error('Failed to create import row');

      const insertedNew = await insertMovementBatch(client, importId, toInsert, 'nothing');
      const replaced = await insertMovementBatch(client, importId, replaceRows, 'replace');
      await ensureResolvedCallNos(client);
      const dbSkipped = dbDupes === 'skip' ? dbHits.length : 0;
      const inFileImported = inFileDupes === 'import' ? extras.length : 0;
      const duplicates =
        (inFileDupes === 'skip' ? rows.length - firsts.length : 0) + dbSkipped;

      await client.query(
        `
        UPDATE spare_stock_imports
        SET inserted = $2, duplicates = $3
        WHERE id = $1
        `,
        [importId, insertedNew + replaced, duplicates]
      );
      await client.query('COMMIT');
      return {
        kind: 'imported',
        parsed: rows.length,
        inserted: insertedNew + replaced,
        duplicates,
        skipped,
        fileName,
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
