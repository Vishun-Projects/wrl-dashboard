import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { appDatabaseBulkStatementTimeoutMs, withAppClient } from '@/lib/read-model/db';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  calcMonths,
  cellText,
  mapSheetHeaders,
  parseDateVal,
  warrantyDateRank,
} from '../import-parse';
import { refreshWarrantyMasterRollup } from '../db';

type WarrantyImportRow = {
  serialNo: string;
  billingDoc: string | null;
  billingDate: string | null;
  material: string | null;
  groupName: string | null;
  materialGroup: string | null;
  customerName: string | null;
  customerSubgroup: string | null;
  shipToParty: string | null;
  shipToState: string | null;
  shipToCity: string | null;
  inventoryNumber: string | null;
  warrStartDt: string | null;
  warrEndDt: string | null;
  pinCode: string | null;
  warrantyMonths: number;
};

type PgClient = {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
};

/** Larger chunks + one connection; was 500 × withAppClient (tunnel tax). */
const CHUNK_SIZE = 2500;

const DROP_SECONDARY_INDEXES_SQL = `
DROP INDEX IF EXISTS public.idx_wm_items_serial_upper;
DROP INDEX IF EXISTS public.idx_wm_items_customer;
DROP INDEX IF EXISTS public.idx_wm_items_cust_subgroup;
DROP INDEX IF EXISTS public.idx_wm_items_group;
DROP INDEX IF EXISTS public.idx_wm_items_material;
DROP INDEX IF EXISTS public.idx_wm_items_warr_end;
DROP INDEX IF EXISTS public.idx_wm_items_active;
DROP INDEX IF EXISTS public.idx_wm_items_state;
DROP INDEX IF EXISTS public.idx_wm_items_agg;
`;

const CREATE_SECONDARY_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_wm_items_serial_upper ON public.warranty_master_items (UPPER(serial_no));
CREATE INDEX IF NOT EXISTS idx_wm_items_customer ON public.warranty_master_items (customer_name);
CREATE INDEX IF NOT EXISTS idx_wm_items_cust_subgroup ON public.warranty_master_items (customer_subgroup);
CREATE INDEX IF NOT EXISTS idx_wm_items_group ON public.warranty_master_items (group_name);
CREATE INDEX IF NOT EXISTS idx_wm_items_material ON public.warranty_master_items (material);
CREATE INDEX IF NOT EXISTS idx_wm_items_warr_end ON public.warranty_master_items (warr_end_dt);
CREATE INDEX IF NOT EXISTS idx_wm_items_active ON public.warranty_master_items (is_active);
CREATE INDEX IF NOT EXISTS idx_wm_items_state ON public.warranty_master_items (ship_to_state);
CREATE INDEX IF NOT EXISTS idx_wm_items_agg ON public.warranty_master_items (customer_name, group_name, warranty_months, material);
`;

function rowFromRaw(
  r: Record<string, unknown>,
  keyMap: Record<string, string>
): WarrantyImportRow | null {
  const serial = cellText(r[keyMap.serial]);
  if (!serial) return null;

  const warrStartDt = keyMap.warrStart ? parseDateVal(r[keyMap.warrStart]) : null;
  const warrEndDt = keyMap.warrEnd ? parseDateVal(r[keyMap.warrEnd]) : null;

  return {
    serialNo: serial,
    billingDoc: keyMap.billingDoc ? cellText(r[keyMap.billingDoc]) : null,
    billingDate: keyMap.billingDate ? parseDateVal(r[keyMap.billingDate]) : null,
    material: keyMap.material ? cellText(r[keyMap.material]) : null,
    groupName: keyMap.groupName ? cellText(r[keyMap.groupName]) : null,
    materialGroup: keyMap.materialGroup ? cellText(r[keyMap.materialGroup]) : null,
    customerName: keyMap.customer ? cellText(r[keyMap.customer]) : null,
    customerSubgroup: keyMap.customerSubgroup ? cellText(r[keyMap.customerSubgroup]) : null,
    shipToParty: keyMap.shipTo ? cellText(r[keyMap.shipTo]) : null,
    shipToState: keyMap.state ? cellText(r[keyMap.state]) : null,
    shipToCity: keyMap.shipToCity ? cellText(r[keyMap.shipToCity]) : null,
    inventoryNumber: keyMap.inventory ? cellText(r[keyMap.inventory]) : null,
    warrStartDt,
    warrEndDt,
    pinCode: keyMap.pin ? cellText(r[keyMap.pin]) : null,
    warrantyMonths: calcMonths(warrStartDt, warrEndDt),
  };
}

function dedupeChunk(rows: WarrantyImportRow[]): WarrantyImportRow[] {
  const bySerial = new Map<string, WarrantyImportRow>();
  for (const row of rows) {
    const current = bySerial.get(row.serialNo);
    if (!current || warrantyDateRank(row.warrEndDt) >= warrantyDateRank(current.warrEndDt)) {
      bySerial.set(row.serialNo, row);
    }
  }
  return Array.from(bySerial.values());
}

/** Cap phantom Excel used-range (wide empty columns make sheet_to_json crawl). */
function clampSheetUsedRange(sheet: XLSX.WorkSheet, maxCol = 14): void {
  if (!sheet['!ref']) return;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.c > maxCol) {
    range.e.c = maxCol;
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
}

function readSheetHeaders(sheet: XLSX.WorkSheet): { headers: string[]; range: XLSX.Range } | null {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const raw = cell?.v;
    headers.push(raw == null || raw === '' ? `COL${c}` : String(raw));
  }
  return { headers, range };
}

function aoaToRecords(headers: string[], aoa: unknown[][]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const arr of aoa) {
    if (!arr || arr.length === 0) continue;
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]!] = arr[i] ?? null;
    }
    out.push(obj);
  }
  return out;
}

async function upsertChunk(
  client: PgClient,
  rows: WarrantyImportRow[],
  today: string,
  bulkReplace: boolean
): Promise<number> {
  if (rows.length === 0) return 0;
  const valueClauses: string[] = [];
  const params: unknown[] = [];
  let p = 1;

  for (const row of rows) {
    valueClauses.push(
      `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}, $${p + 14}, $${p + 15}, $${p + 16})`
    );
    params.push(
      row.serialNo,
      row.billingDoc,
      row.billingDate,
      row.material,
      row.groupName,
      row.materialGroup,
      row.customerName,
      row.customerSubgroup,
      row.shipToParty,
      row.shipToState,
      row.shipToCity,
      row.inventoryNumber,
      row.warrStartDt,
      row.warrEndDt,
      row.pinCode,
      row.warrantyMonths,
      Boolean(row.warrEndDt && row.warrEndDt >= today)
    );
    p += 17;
  }

  // Replace-all: always take the incoming row on conflict (files are full reload).
  // Merge: keep newer warranty end only.
  const onConflict = bulkReplace
    ? `
      ON CONFLICT (serial_no) DO UPDATE SET
        billing_doc = EXCLUDED.billing_doc,
        billing_date = EXCLUDED.billing_date,
        material = EXCLUDED.material,
        group_name = EXCLUDED.group_name,
        material_group = EXCLUDED.material_group,
        customer_name = EXCLUDED.customer_name,
        customer_subgroup = EXCLUDED.customer_subgroup,
        ship_to_party = EXCLUDED.ship_to_party,
        ship_to_state = EXCLUDED.ship_to_state,
        ship_to_city = EXCLUDED.ship_to_city,
        inventory_number = EXCLUDED.inventory_number,
        warr_start_dt = EXCLUDED.warr_start_dt,
        warr_end_dt = EXCLUDED.warr_end_dt,
        pin_code = EXCLUDED.pin_code,
        warranty_months = EXCLUDED.warranty_months,
        is_active = EXCLUDED.is_active,
        imported_at = NOW()
      `
    : `
      ON CONFLICT (serial_no) DO UPDATE SET
        billing_doc = COALESCE(EXCLUDED.billing_doc, warranty_master_items.billing_doc),
        billing_date = COALESCE(EXCLUDED.billing_date, warranty_master_items.billing_date),
        material = COALESCE(EXCLUDED.material, warranty_master_items.material),
        group_name = COALESCE(EXCLUDED.group_name, warranty_master_items.group_name),
        material_group = COALESCE(EXCLUDED.material_group, warranty_master_items.material_group),
        customer_name = COALESCE(EXCLUDED.customer_name, warranty_master_items.customer_name),
        customer_subgroup = COALESCE(EXCLUDED.customer_subgroup, warranty_master_items.customer_subgroup),
        ship_to_party = COALESCE(EXCLUDED.ship_to_party, warranty_master_items.ship_to_party),
        ship_to_state = COALESCE(EXCLUDED.ship_to_state, warranty_master_items.ship_to_state),
        ship_to_city = COALESCE(EXCLUDED.ship_to_city, warranty_master_items.ship_to_city),
        inventory_number = COALESCE(EXCLUDED.inventory_number, warranty_master_items.inventory_number),
        warr_start_dt = COALESCE(EXCLUDED.warr_start_dt, warranty_master_items.warr_start_dt),
        warr_end_dt = COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt),
        pin_code = COALESCE(EXCLUDED.pin_code, warranty_master_items.pin_code),
        warranty_months = EXCLUDED.warranty_months,
        is_active = (COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) IS NOT NULL AND COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) >= CURRENT_DATE),
        imported_at = NOW()
      WHERE
        (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NOT NULL)
        OR (warranty_master_items.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt >= warranty_master_items.warr_end_dt)
        OR (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NULL)
      `;

  await client.query(
    `
    INSERT INTO public.warranty_master_items (
      serial_no, billing_doc, billing_date, material,
      group_name, material_group, customer_name,
      customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
      inventory_number, warr_start_dt, warr_end_dt, pin_code,
      warranty_months, is_active
    ) VALUES ${valueClauses.join(', ')}
    ${onConflict}
    `,
    params
  );

  return rows.length;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'warranty_master' });
    if (!auth.ok) return auth.response;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Failed to read upload' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const mode = String(formData.get('mode') ?? 'merge');
    const refreshRollup = String(formData.get('refreshRollup') ?? '1') !== '0';
    // Replace-all multi-file session: faster upsert + drop secondary indexes around the load.
    const bulkReplace = String(formData.get('bulkReplace') ?? '0') === '1' || mode === 'truncate';
    const dropIndexes = String(formData.get('dropIndexes') ?? '0') === '1';
    const rebuildIndexes = String(formData.get('rebuildIndexes') ?? '0') === '1';

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isCsv = fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt');

    if (!isExcel && !isCsv) {
      return NextResponse.json({ error: 'Upload a valid .xlsx or .csv file' }, { status: 400 });
    }

    console.log(
      `[warranty-master-import] start ${file.name} mode=${mode} bulk=${bulkReplace ? 1 : 0} dropIdx=${dropIndexes ? 1 : 0} rebuildIdx=${rebuildIndexes ? 1 : 0}`
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    console.log(`[warranty-master-import] buffered ${file.name} (${(buffer.length / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - started}ms`);

    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    console.log(
      `[warranty-master-import] parsed ${file.name} sheets=${workbook.SheetNames.length} in ${Date.now() - started}ms`
    );

    let totalImported = 0;
    let sheetsProcessed = 0;
    const today = new Date().toISOString().slice(0, 10);
    const bulkTimeout = Math.max(appDatabaseBulkStatementTimeoutMs(), 600_000);

    await withAppClient(
      async (client) => {
        await client.query('SET synchronous_commit = off');

        if (mode === 'truncate') {
          await client.query('TRUNCATE TABLE public.warranty_master_items RESTART IDENTITY CASCADE');
          console.log(`[warranty-master-import] truncated in ${Date.now() - started}ms`);
        }

        if (dropIndexes) {
          await client.query(DROP_SECONDARY_INDEXES_SQL);
          console.log(`[warranty-master-import] dropped secondary indexes in ${Date.now() - started}ms`);
        }

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;

          const sheetStarted = Date.now();
          clampSheetUsedRange(sheet);
          const headerInfo = readSheetHeaders(sheet);
          if (!headerInfo) continue;

          const keyMap = mapSheetHeaders(headerInfo.headers);
          if (!keyMap.serial) continue;

          const { range, headers } = headerInfo;
          const dataStart = range.s.r + 1;
          const dataEnd = range.e.r;
          if (dataEnd < dataStart) continue;

          const approxRows = dataEnd - dataStart + 1;
          sheetsProcessed += 1;
          let sheetImported = 0;
          console.log(
            `[warranty-master-import] sheet ${file.name}/${sheetName}: ~${approxRows.toLocaleString()} rows (ranged batches)`
          );

          // Don't sheet_to_json the whole sheet — that blocked for minutes with no logs after "parsed".
          for (let r0 = dataStart; r0 <= dataEnd; r0 += CHUNK_SIZE) {
            const r1 = Math.min(r0 + CHUNK_SIZE - 1, dataEnd);
            const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
              header: 1,
              raw: true,
              defval: null,
              blankrows: false,
              range: { s: { r: r0, c: range.s.c }, e: { r: r1, c: range.e.c } },
            });
            const rawRows = aoaToRecords(headers, aoa);
            const chunk: WarrantyImportRow[] = [];
            for (const r of rawRows) {
              const row = rowFromRaw(r, keyMap);
              if (row) chunk.push(row);
            }
            if (chunk.length === 0) continue;

            const n = await upsertChunk(client, dedupeChunk(chunk), today, bulkReplace);
            totalImported += n;
            sheetImported += n;
            console.log(
              `[warranty-master-import] ${file.name} / ${sheetName}: ${sheetImported.toLocaleString()} rows (${Date.now() - started}ms)`
            );
          }

          console.log(
            `[warranty-master-import] sheet done ${file.name}/${sheetName}: ${sheetImported.toLocaleString()} rows in ${Date.now() - sheetStarted}ms`
          );
        }

        if (rebuildIndexes) {
          await client.query(CREATE_SECONDARY_INDEXES_SQL);
          console.log(`[warranty-master-import] rebuilt secondary indexes in ${Date.now() - started}ms`);
        }

        if (refreshRollup) {
          await client.query(`
            UPDATE public.warranty_master_items
            SET is_active = (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
            WHERE is_active IS DISTINCT FROM (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
          `);
        }
      },
      { statementTimeoutMs: bulkTimeout }
    );

    if (refreshRollup) {
      await refreshWarrantyMasterRollup();
    }

    const totalCount = await withAppClient(async (client) => {
      const r = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM public.warranty_master_items'
      );
      return Number(r.rows[0]?.count ?? 0);
    }, { statementTimeoutMs: bulkTimeout });

    console.log(
      `[warranty-master-import] done ${file.name}: imported=${totalImported} total=${totalCount} in ${Date.now() - started}ms`
    );

    return NextResponse.json({
      ok: true,
      importedCount: totalImported,
      sheetsProcessed,
      totalMachines: totalCount,
      message: `Successfully processed ${totalImported.toLocaleString()} machines across ${sheetsProcessed} sheet(s)`,
    });
  } catch (err) {
    console.error('[warranty-master-import]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
