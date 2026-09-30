import { withAppClient } from '@/lib/read-model/db';
import { isPlantInScope } from '@/modules/zss02/server/office-scope';
import type {
  Zss02ImportMeta,
  Zss02ImportResult,
  Zss02OptionsResponse,
  Zss02ParsedRow,
  Zss02Row,
  Zss02RowsResponse,
} from '@/modules/zss02/types';

const BATCH = 800;

/** SAP loan_date cell → ISO yyyy-mm-dd, or null if blank/invalid. */
export function parseSapLoanDate(raw: string): string | null {
  const t = raw.replace(/\s+/g, '').trim();
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Split pasted barcode list (newline / comma / semicolon). */
export function parseBarcodeSearch(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n\r,;]+/)) {
    const code = part.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

export type Zss02RowFilters = {
  allowedPlants: string[] | null;
  plants: string[];
  vendors: string[];
  /** CRM item category names (mstitemcategory.vname). */
  itemGroups: string[];
  materials: string[];
  /** Raw paste; parsed into one or more barcodes. */
  barcode: string;
  importId: string;
  loanFrom: string;
  loanTo: string;
  page: number;
  pageSize: number;
};

function buildWhere(
  filters: Omit<Zss02RowFilters, 'page' | 'pageSize'>,
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
  if (filters.vendors.length) {
    conds.push(`vendor_no = ANY($${i++}::text[])`);
    values.push(filters.vendors);
  }
  if (filters.materials.length) {
    conds.push(`material = ANY($${i++}::text[])`);
    values.push(filters.materials);
  }
  const barcodes = parseBarcodeSearch(filters.barcode);
  if (barcodes.length === 1) {
    conds.push(`barcode ILIKE $${i++}`);
    values.push(`%${barcodes[0]}%`);
  } else if (barcodes.length > 1) {
    conds.push(`barcode = ANY($${i++}::text[])`);
    values.push(barcodes);
  }
  if (filters.importId) {
    conds.push(`import_id = $${i++}::uuid`);
    values.push(filters.importId);
  }
  if (filters.loanFrom || filters.loanTo) {
    const loanIso = `
      CASE
        WHEN loan_date ~ '^\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*$'
        THEN to_date(trim(loan_date), 'DD.MM.YYYY')
        ELSE NULL
      END
    `;
    if (filters.loanFrom) {
      conds.push(`${loanIso} >= $${i++}::date`);
      values.push(filters.loanFrom);
    }
    if (filters.loanTo) {
      conds.push(`${loanIso} <= $${i++}::date`);
      values.push(filters.loanTo);
    }
  }

  return { sql: conds.join(' AND '), values, next: i };
}

function mapRow(r: Record<string, unknown>): Zss02Row {
  return {
    id: Number(r.id) || 0,
    importId: String(r.import_id ?? ''),
    plant: String(r.plant ?? ''),
    plantName: null,
    itemGroup: null,
    issue: null,
    issueDetail: null,
    vendorNo: String(r.vendor_no ?? ''),
    vendorName: String(r.vendor_name ?? ''),
    material: String(r.material ?? ''),
    materialDescription: String(r.material_description ?? ''),
    barcode: String(r.barcode ?? ''),
    soConRtn: String(r.so_con_rtn ?? ''),
    soLoan: String(r.so_loan ?? ''),
    loanDate: String(r.loan_date ?? ''),
    loanRtnDate: String(r.loan_rtn_date ?? ''),
    cnsmpDate: String(r.cnsmp_date ?? ''),
    noCnsmpCount: String(r.no_cnsmp_count ?? ''),
    saleDate: String(r.sale_date ?? ''),
    saleRtnDate: String(r.sale_rtn_date ?? ''),
  };
}

/** Max loan_date in DB as DD-MM-YYYY (SAP text cells). */
export async function fetchLatestLoanDate(
  allowedPlants: string[] | null
): Promise<string | null> {
  return withAppClient(async (client) => {
    const scope =
      allowedPlants != null ? `AND plant = ANY($1::text[])` : '';
    const params = allowedPlants != null ? [allowedPlants] : [];
    const { rows } = await client.query<{ latest: string | null }>(
      `
      SELECT to_char(
        MAX(
          CASE
            WHEN loan_date ~ '^\\s*\\d{2}\\.\\d{2}\\.\\d{4}\\s*$'
            THEN to_date(trim(loan_date), 'DD.MM.YYYY')
            ELSE NULL
          END
        ),
        'DD-MM-YYYY'
      ) AS latest
      FROM zss02_rows
      WHERE 1=1 ${scope}
      `,
      params
    );
    return rows[0]?.latest ?? null;
  });
}

/** Split parsed rows into in-scope vs skipped for office restrictions. */
export function partitionByPlantScope(
  rows: Zss02ParsedRow[],
  allowedPlants: string[] | null
): { keep: Zss02ParsedRow[]; skippedOutOfScope: number } {
  if (allowedPlants == null) return { keep: rows, skippedOutOfScope: 0 };
  const keep: Zss02ParsedRow[] = [];
  let skippedOutOfScope = 0;
  for (const row of rows) {
    if (isPlantInScope(row.plant, allowedPlants)) keep.push(row);
    else skippedOutOfScope += 1;
  }
  return { keep, skippedOutOfScope };
}

export function normalizeZss02FileName(fileName: string): string {
  return fileName.trim();
}

/** Distinct plants from parsed rows (stable sort). */
export function plantsInRows(rows: Zss02ParsedRow[]): string[] {
  return [...new Set(rows.map((r) => r.plant).filter(Boolean))].sort();
}

export async function insertZss02Import(opts: {
  fileName: string;
  uploadedBy: string | null;
  rows: Zss02ParsedRow[];
  skipped: number;
}): Promise<Zss02ImportResult> {
  const fileName = normalizeZss02FileName(opts.fileName);
  const plants = plantsInRows(opts.rows);
  return withAppClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Overwrite: drop prior rows for plants in this file (any previous import).
      if (plants.length) {
        await client.query(`DELETE FROM zss02_rows WHERE plant = ANY($1::text[])`, [plants]);
      }
      await client.query(
        `
        DELETE FROM zss02_imports i
        WHERE lower(i.file_name) = lower($1)
           OR NOT EXISTS (SELECT 1 FROM zss02_rows r WHERE r.import_id = i.id)
        `,
        [fileName]
      );

      const ins = await client.query<{ id: string }>(
        `
        INSERT INTO zss02_imports (file_name, uploaded_by, parsed, skipped)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [fileName, opts.uploadedBy, opts.rows.length, opts.skipped]
      );
      const importId = ins.rows[0]?.id;
      if (!importId) throw new Error('Failed to create ZSS02 import');

      for (let offset = 0; offset < opts.rows.length; offset += BATCH) {
        const chunk = opts.rows.slice(offset, offset + BATCH);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let p = 1;
        for (const row of chunk) {
          placeholders.push(
            `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
          );
          values.push(
            importId,
            row.plant,
            row.vendorNo,
            row.vendorName,
            row.material,
            row.materialDescription,
            row.barcode,
            row.soConRtn,
            row.soLoan,
            row.loanDate,
            row.loanRtnDate,
            row.cnsmpDate,
            row.noCnsmpCount,
            row.saleDate,
            row.saleRtnDate
          );
        }
        await client.query(
          `
          INSERT INTO zss02_rows (
            import_id, plant, vendor_no, vendor_name, material, material_description,
            barcode, so_con_rtn, so_loan, loan_date, loan_rtn_date, cnsmp_date,
            no_cnsmp_count, sale_date, sale_rtn_date
          )
          VALUES ${placeholders.join(',')}
          `,
          values
        );
      }

      await client.query('COMMIT');
      return {
        importId,
        fileName,
        parsed: opts.rows.length,
        skipped: opts.skipped,
        plantsOverwritten: plants,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function listZss02Imports(
  allowedPlants: string[] | null
): Promise<Zss02ImportMeta[]> {
  return withAppClient(async (client) => {
    const restrict = allowedPlants != null;
    const { rows } = await client.query<{
      id: string;
      file_name: string;
      parsed: number;
      skipped: number;
      imported_at: Date;
    }>(
      restrict
        ? `
      SELECT i.id, i.file_name, i.parsed, i.skipped, i.imported_at
      FROM zss02_imports i
      WHERE EXISTS (
        SELECT 1 FROM zss02_rows r
        WHERE r.import_id = i.id AND r.plant = ANY($1::text[])
      )
      ORDER BY i.imported_at DESC
      `
        : `
      SELECT id, file_name, parsed, skipped, imported_at
      FROM zss02_imports
      ORDER BY imported_at DESC
      `,
      restrict ? [allowedPlants] : []
    );
    return rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      parsed: Number(r.parsed) || 0,
      skipped: Number(r.skipped) || 0,
      importedAt: r.imported_at.toISOString(),
    }));
  });
}

/** zss02 material → local CRM item group (one row per norm code). */
const ZSS02_ITEM_CAT_CTE = `
item_cat AS (
  SELECT DISTINCT ON (i.norm_vitemcode)
    i.norm_vitemcode,
    COALESCE(NULLIF(btrim(c.vname), ''), NULLIF(btrim(c.vshortname), '')) AS item_group
  FROM crm_mstitems i
  LEFT JOIN crm_mstitemcategory c ON c.ncode = i.nitemcategory
  ORDER BY i.norm_vitemcode, i.bactive DESC, i.ncode
)`;

/** Distinct SAP material codes in scope that belong to the given CRM item groups. */
async function materialsForItemGroups(
  itemGroups: string[],
  allowedPlants: string[] | null
): Promise<string[]> {
  const wanted = itemGroups.map((g) => g.trim()).filter(Boolean);
  if (!wanted.length) return [];

  return withAppClient(async (client) => {
    const plantClause =
      allowedPlants != null ? `AND z.plant = ANY($2::text[])` : '';
    const params: unknown[] =
      allowedPlants != null ? [wanted, allowedPlants] : [wanted];
    const { rows } = await client.query<{ material: string }>(
      `
      WITH ${ZSS02_ITEM_CAT_CTE}
      SELECT DISTINCT z.material
      FROM zss02_rows z
      JOIN item_cat ic
        ON ic.norm_vitemcode = regexp_replace(btrim(z.material), '^0+', '')
      WHERE ic.item_group = ANY($1::text[])
        ${plantClause}
      `,
      params
    );
    return rows.map((r) => r.material).filter(Boolean);
  });
}

async function resolveRowFilters(
  filters: Omit<Zss02RowFilters, 'page' | 'pageSize'>
): Promise<Omit<Zss02RowFilters, 'page' | 'pageSize'> | 'empty'> {
  if (!filters.itemGroups.length) return filters;

  const inGroup = await materialsForItemGroups(filters.itemGroups, filters.allowedPlants);
  if (!inGroup.length) return 'empty';

  const materials = filters.materials.length
    ? filters.materials.filter((m) => inGroup.includes(m))
    : inGroup;
  if (!materials.length) return 'empty';

  return { ...filters, materials };
}

export async function fetchZss02Options(
  allowedPlants: string[] | null
): Promise<Zss02OptionsResponse> {
  const [dbOpts, latestLoanDate] = await Promise.all([
    withAppClient(async (client) => {
      const scope =
        allowedPlants != null ? `WHERE plant = ANY($1::text[])` : '';
      const params = allowedPlants != null ? [allowedPlants] : [];

      const [plants, vendors, materials] = await Promise.all([
        client.query<{ plant: string }>(
          `SELECT DISTINCT plant FROM zss02_rows ${scope} ORDER BY plant`,
          params
        ),
        client.query<{ vendor_no: string; vendor_name: string }>(
          `
          SELECT DISTINCT vendor_no, vendor_name
          FROM zss02_rows
          ${scope}
          ORDER BY vendor_no
          `,
          params
        ),
        client.query<{ material: string; material_description: string }>(
          `
          SELECT DISTINCT material, material_description
          FROM zss02_rows
          ${scope}
          ORDER BY material
          `,
          params
        ),
      ]);

      return {
        plantCodes: plants.rows.map((r) => r.plant).filter(Boolean),
        vendors: vendors.rows
          .filter((r) => r.vendor_no)
          .map((r) => ({
            value: r.vendor_no,
            label: r.vendor_name ? `${r.vendor_no} — ${r.vendor_name}` : r.vendor_no,
          })),
        materials: materials.rows
          .filter((r) => r.material)
          .map((r) => ({
            value: r.material,
            label: r.material_description
              ? `${r.material} — ${r.material_description}`
              : r.material,
          })),
      };
    }),
    fetchLatestLoanDate(allowedPlants),
  ]);

  const [{ lookupPlantMeta }, { branchFileLabel }, itemGroups] = await Promise.all([
    import('@/modules/spare-loan-check/crm-match'),
    import('@/modules/spare-loan-check/export-labels'),
    withAppClient(async (client) => {
      const plantClause =
        allowedPlants != null ? `AND z.plant = ANY($1::text[])` : '';
      const params = allowedPlants != null ? [allowedPlants] : [];
      const { rows } = await client.query<{ item_group: string }>(
        `
        WITH ${ZSS02_ITEM_CAT_CTE}
        SELECT DISTINCT ic.item_group
        FROM zss02_rows z
        JOIN item_cat ic
          ON ic.norm_vitemcode = regexp_replace(btrim(z.material), '^0+', '')
        WHERE ic.item_group IS NOT NULL
          AND btrim(ic.item_group) <> ''
          ${plantClause}
        ORDER BY 1
        `,
        params
      );
      return rows.map((r) => ({
        value: r.item_group,
        label: r.item_group,
      }));
    }),
  ]);
  const plantMeta = await lookupPlantMeta(dbOpts.plantCodes);

  return {
    plants: dbOpts.plantCodes.map((code) => ({
      value: code,
      label: branchFileLabel(code, plantMeta.get(code.trim())?.plantName ?? null),
    })),
    vendors: dbOpts.vendors,
    itemGroups,
    materials: dbOpts.materials,
    latestLoanDate,
  };
}

export async function queryZss02Rows(filters: Zss02RowFilters): Promise<Zss02RowsResponse> {
  const resolved = await resolveRowFilters(filters);
  if (resolved === 'empty') {
    return { rows: [], total: 0, page: filters.page, pageSize: filters.pageSize };
  }
  const where = buildWhere(resolved, 1);
  const offset = (filters.page - 1) * filters.pageSize;
  const limitPh = `$${where.next}`;
  const offsetPh = `$${where.next + 1}`;
  const values = [...where.values, filters.pageSize, offset];

  const { mapped, total } = await withAppClient(async (client) => {
    const countRes = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM zss02_rows WHERE ${where.sql}`,
      where.values
    );
    const { rows } = await client.query(
      `
      SELECT
        id, import_id, plant, vendor_no, vendor_name, material, material_description,
        barcode, so_con_rtn, so_loan, loan_date, loan_rtn_date, cnsmp_date,
        no_cnsmp_count, sale_date, sale_rtn_date
      FROM zss02_rows
      WHERE ${where.sql}
      ORDER BY plant, vendor_no, material, barcode, id
      LIMIT ${limitPh} OFFSET ${offsetPh}
      `,
      values
    );
    return {
      mapped: rows.map(mapRow),
      total: Number(countRes.rows[0]?.n) || 0,
    };
  });

  const { enrichZss02Rows } = await import('@/modules/zss02/server/enrich');
  return {
    rows: await enrichZss02Rows(mapped),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

const EXPORT_PAGE = 2000;
const MAX_EXPORT_ROWS = 100_000;

/** All matching rows for Excel (capped). */
export async function queryZss02AllRows(
  filters: Omit<Zss02RowFilters, 'page' | 'pageSize'>
): Promise<{ rows: Zss02Row[]; total: number; truncated: boolean }> {
  const resolved = await resolveRowFilters(filters);
  if (resolved === 'empty') return { rows: [], total: 0, truncated: false };

  const rows: Zss02Row[] = [];
  let total = 0;
  let page = 1;
  for (;;) {
    const batch = await queryZss02Rows({
      ...resolved,
      itemGroups: [], // already resolved into materials
      page,
      pageSize: EXPORT_PAGE,
    });
    total = batch.total;
    rows.push(...batch.rows);
    if (rows.length >= total || batch.rows.length === 0) {
      return { rows, total, truncated: false };
    }
    if (rows.length >= MAX_EXPORT_ROWS) {
      return { rows: rows.slice(0, MAX_EXPORT_ROWS), total, truncated: true };
    }
    page += 1;
  }
}
