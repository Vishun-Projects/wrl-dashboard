import type { PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

export type SapVendorMasterRow = {
  vendorCode: string;
  vendorName: string;
  validFrom?: string | null;
};

export type SapVendorMasterListRow = {
  vendorCode: string;
  vendorName: string;
  validFrom: string | null;
  updatedAt: string | null;
};

export type SapVendorMasterListResult = {
  rows: SapVendorMasterListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export function normVendorCode(code: unknown): string {
  return String(code ?? '').trim();
}

/** Prefer SAP Vendor Master name whenever the code is known. */
export function enrichMb51VendorNames(
  rows: Mb51AgingMovement[],
  masterByCode: Map<string, string>
): Mb51AgingMovement[] {
  if (!rows.length || !masterByCode.size) return rows;
  return rows.map((r) => {
    const code = normVendorCode(r.v);
    if (!code) return r;
    const name = masterByCode.get(code);
    if (!name) return r;
    if (r.vn === name) return r;
    return { ...r, vn: name };
  });
}

export async function loadSapVendorNameMap(
  client: PoolClient,
  codes?: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (codes) {
    const uniq = [...new Set(codes.map(normVendorCode).filter(Boolean))];
    if (!uniq.length) return map;
    const res = await client.query<{ vendor_code: string; vendor_name: string }>(
      `
      SELECT vendor_code, vendor_name
      FROM sap_vendor_master
      WHERE vendor_code = ANY($1::text[])
        AND vendor_name <> ''
      `,
      [uniq]
    );
    for (const r of res.rows) map.set(r.vendor_code, r.vendor_name);
    return map;
  }

  const res = await client.query<{ vendor_code: string; vendor_name: string }>(
    `
    SELECT vendor_code, vendor_name
    FROM sap_vendor_master
    WHERE vendor_name <> ''
    `
  );
  for (const r of res.rows) map.set(r.vendor_code, r.vendor_name);
  return map;
}

export async function upsertSapVendorMaster(
  client: PoolClient,
  rows: SapVendorMasterRow[]
): Promise<number> {
  if (!rows.length) return 0;
  let upserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const ph: string[] = [];
    let p = 1;
    for (const row of chunk) {
      const code = normVendorCode(row.vendorCode);
      if (!code) continue;
      ph.push(`($${p++},$${p++},$${p++}, now())`);
      values.push(code, String(row.vendorName ?? '').trim(), row.validFrom || null);
    }
    if (!ph.length) continue;
    await client.query(
      `
      INSERT INTO sap_vendor_master (vendor_code, vendor_name, valid_from, updated_at)
      VALUES ${ph.join(',')}
      ON CONFLICT (vendor_code) DO UPDATE
        SET vendor_name = EXCLUDED.vendor_name,
            valid_from = COALESCE(EXCLUDED.valid_from, sap_vendor_master.valid_from),
            updated_at = now()
      `,
      values
    );
    upserted += ph.length;
  }
  return upserted;
}

function cellText(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellText((v as { result: unknown }).result);
  }
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = cellText(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Parse Vend Master.xlsx / .xls buffer (Supplier + Name 1 [+ ValidFrom]). */
export async function parseSapVendorMasterWorkbook(
  data: ArrayBuffer | Buffer | Uint8Array
): Promise<SapVendorMasterRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet in vendor master file');

  const header = ws.getRow(1);
  const hdr: string[] = [];
  header.eachCell({ includeEmpty: true }, (cell, col) => {
    hdr[col - 1] = cellText(cell.value).toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  const codeIx = hdr.findIndex((h) =>
    ['supplier', 'vendor', 'vendorcode', 'suppliercode', 'code'].includes(h)
  );
  const nameIx = hdr.findIndex((h) =>
    ['name1', 'name', 'vendorname', 'suppliername'].includes(h)
  );
  const validIx = hdr.findIndex((h) => h === 'validfrom' || h === 'validfromdate');
  if (codeIx < 0 || nameIx < 0) {
    throw new Error(
      `Need Supplier + Name 1 columns. Got: ${hdr.filter(Boolean).join(' | ') || '(empty)'}`
    );
  }

  const out: SapVendorMasterRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = cellText(row.getCell(codeIx + 1).value);
    if (!code) return;
    out.push({
      vendorCode: code,
      vendorName: cellText(row.getCell(nameIx + 1).value),
      validFrom: validIx >= 0 ? cellDate(row.getCell(validIx + 1).value) : null,
    });
  });
  return out;
}

export async function listSapVendorMaster(
  client: PoolClient,
  opts: { q?: string; page?: number; pageSize?: number } = {}
): Promise<SapVendorMasterListResult> {
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const q = String(opts.q ?? '').trim();
  const params: unknown[] = [];
  let where = '';
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where = `WHERE lower(vendor_code) LIKE $1 OR lower(vendor_name) LIKE $1`;
  }
  const totalRes = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sap_vendor_master ${where}`,
    params
  );
  const total = totalRes.rows[0]?.n ?? 0;
  const offset = (page - 1) * pageSize;
  const listParams = [...params, pageSize, offset];
  const limitPh = `$${params.length + 1}`;
  const offsetPh = `$${params.length + 2}`;
  const res = await client.query<{
    vendor_code: string;
    vendor_name: string;
    valid_from: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `
    SELECT vendor_code, vendor_name, valid_from, updated_at
    FROM sap_vendor_master
    ${where}
    ORDER BY vendor_code
    LIMIT ${limitPh} OFFSET ${offsetPh}
    `,
    listParams
  );
  return {
    total,
    page,
    pageSize,
    rows: res.rows.map((r) => ({
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      validFrom:
        r.valid_from == null
          ? null
          : typeof r.valid_from === 'string'
            ? r.valid_from.slice(0, 10)
            : r.valid_from.toISOString().slice(0, 10),
      updatedAt:
        r.updated_at == null
          ? null
          : typeof r.updated_at === 'string'
            ? r.updated_at
            : r.updated_at.toISOString(),
    })),
  };
}

/** Fill / overwrite mb51_aging_rows.vendor_name from SAP Vendor Master. */
export async function applySapVendorMasterToMb51(
  client: PoolClient,
  importId?: string | null
): Promise<number> {
  const res = importId
    ? await client.query<{ n: number }>(
        `
        WITH updated AS (
          UPDATE mb51_aging_rows r
          SET vendor_name = m.vendor_name
          FROM sap_vendor_master m
          WHERE r.import_id = $1
            AND r.vendor = m.vendor_code
            AND m.vendor_name <> ''
            AND r.vendor_name IS DISTINCT FROM m.vendor_name
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM updated
        `,
        [importId]
      )
    : await client.query<{ n: number }>(
        `
        WITH updated AS (
          UPDATE mb51_aging_rows r
          SET vendor_name = m.vendor_name
          FROM sap_vendor_master m
          WHERE r.vendor = m.vendor_code
            AND m.vendor_name <> ''
            AND r.vendor_name IS DISTINCT FROM m.vendor_name
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM updated
        `
      );
  return res.rows[0]?.n ?? 0;
}
