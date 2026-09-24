import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { withAppClient } from '@/lib/read-model/db';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  calcMonths,
  cleanCustomerName,
  mapSheetHeaders,
  parseDateVal,
  remapCustomerSubgroup,
  warrantyDateRank,
} from '../import-parse';

type WarrantyImportRow = {
  serialNo: string;
  billingDoc: string;
  billingDate: string | null;
  fgModel: string;
  groupName: string;
  materialGroup: string;
  productSubgroup: string;
  customerName: string;
  customerSubgroup: string;
  shipToParty: string;
  shipToState: string;
  shipToCity: string;
  inventoryNumber: string;
  warrStartDt: string | null;
  warrEndDt: string | null;
  city: string;
  pinCode: string;
  sheetYear: number | null;
  warrantyMonths: number;
};

export async function POST(req: NextRequest) {
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
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isCsv = fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt');

    if (!isExcel && !isCsv) {
      return NextResponse.json({ error: 'Upload a valid .xlsx or .csv file' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    let totalImported = 0;
    const today = new Date().toISOString().slice(0, 10);

    if (mode === 'truncate') {
      await withAppClient(async (client) => {
        await client.query('TRUNCATE TABLE public.warranty_master_items RESTART IDENTITY CASCADE;');
      });
    }

    const rowsBySerial = new Map<string, WarrantyImportRow>();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
      if (rawRows.length === 0) continue;

      const firstRow = rawRows[0] || {};
      const keyMap = mapSheetHeaders(Object.keys(firstRow));

      if (!keyMap.serial) continue;

      const sheetYearNum = Number(sheetName.trim());
      const sheetYear = Number.isFinite(sheetYearNum) && sheetYearNum >= 2000 && sheetYearNum <= 2100 ? sheetYearNum : null;

      for (const r of rawRows) {
        const serial = String(r[keyMap.serial] ?? '').trim();
        if (!serial) continue;

        const billingDoc = keyMap.billingDoc ? String(r[keyMap.billingDoc] ?? '').trim() : '';
        const billingDate = keyMap.billingDate ? parseDateVal(r[keyMap.billingDate]) : null;
        const fgModel = keyMap.material ? String(r[keyMap.material] ?? '').trim() : '';
        const groupName = keyMap.groupName ? String(r[keyMap.groupName] ?? '').trim() : '';
        const materialGroup = keyMap.materialGroup ? String(r[keyMap.materialGroup] ?? '').trim() : '';
        const productSubgroup = keyMap.productSubgroup ? String(r[keyMap.productSubgroup] ?? '').trim() : '';
        const customerName = keyMap.customer
          ? cleanCustomerName(String(r[keyMap.customer] ?? ''))
          : '(Unknown)';
        const customerSubgroup = keyMap.customerSubgroup
          ? remapCustomerSubgroup(String(r[keyMap.customerSubgroup] ?? ''))
          : '';
        const shipToParty = keyMap.shipTo ? String(r[keyMap.shipTo] ?? '').trim() : '';
        const shipToState = keyMap.state ? String(r[keyMap.state] ?? '').trim() : '';
        const shipToCity = keyMap.shipToCity ? String(r[keyMap.shipToCity] ?? '').trim() : '';
        const inventoryNumber = keyMap.inventory ? String(r[keyMap.inventory] ?? '').trim() : '';
        const warrStartDt = keyMap.warrStart ? parseDateVal(r[keyMap.warrStart]) : null;
        const warrEndDt = keyMap.warrEnd ? parseDateVal(r[keyMap.warrEnd]) : null;
        const city = keyMap.city ? String(r[keyMap.city] ?? '').trim() : shipToCity;
        const pinCode = keyMap.pin ? String(r[keyMap.pin] ?? '').trim() : '';

        const candidate: WarrantyImportRow = {
          serialNo: serial,
          billingDoc,
          billingDate,
          fgModel,
          groupName,
          materialGroup: materialGroup || '(Unknown)',
          productSubgroup,
          customerName,
          customerSubgroup,
          shipToParty,
          shipToState,
          shipToCity,
          inventoryNumber,
          warrStartDt,
          warrEndDt,
          city,
          pinCode,
          sheetYear,
          warrantyMonths: calcMonths(warrStartDt, warrEndDt),
        };

        const current = rowsBySerial.get(serial);
        // One serial may occur multiple times in the workbook (for example, a warranty extension).
        // Keep the row with the latest warranty end date. Older dates are ignored.
        if (!current || warrantyDateRank(candidate.warrEndDt) >= warrantyDateRank(current.warrEndDt)) {
          rowsBySerial.set(serial, candidate);
        }
      }
    }

    const importRows = Array.from(rowsBySerial.values());
    const chunkSize = 200;

    for (let i = 0; i < importRows.length; i += chunkSize) {
      const slice = importRows.slice(i, i + chunkSize);
      const valueClauses: string[] = [];
      const params: unknown[] = [];
      let p = 1;

      for (const row of slice) {
        valueClauses.push(
          `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}, $${p + 14}, $${p + 15}, $${p + 16}, $${p + 17}, $${p + 18}, $${p + 19}, $${p + 20})`
        );
        params.push(
          row.serialNo,
          row.billingDoc,
          row.billingDate,
          row.fgModel,
          row.fgModel,
          row.groupName,
          row.materialGroup,
          row.productSubgroup,
          row.customerName,
          row.customerSubgroup,
          row.shipToParty,
          row.shipToState,
          row.shipToCity,
          row.inventoryNumber,
          row.warrStartDt,
          row.warrEndDt,
          row.city,
          row.pinCode,
          row.sheetYear,
          row.warrantyMonths,
          Boolean(row.warrEndDt && row.warrEndDt >= today)
        );
        p += 21;
      }

      if (valueClauses.length === 0) continue;

      await withAppClient(async (client) => {
        const sql = `
          INSERT INTO public.warranty_master_items (
            serial_no, billing_doc, billing_date, fg_model, material,
            group_name, material_group, product_subgroup, customer_name,
            customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
            inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
            sheet_year, warranty_months, is_active
          ) VALUES ${valueClauses.join(', ')}
          ON CONFLICT (serial_no) DO UPDATE SET
            billing_doc = COALESCE(NULLIF(EXCLUDED.billing_doc, ''), warranty_master_items.billing_doc),
            billing_date = COALESCE(EXCLUDED.billing_date, warranty_master_items.billing_date),
            fg_model = COALESCE(NULLIF(EXCLUDED.fg_model, ''), NULLIF(EXCLUDED.fg_model, '(Unknown)'), warranty_master_items.fg_model),
            material = COALESCE(NULLIF(EXCLUDED.material, ''), NULLIF(EXCLUDED.material, '(Unknown)'), warranty_master_items.material),
            group_name = COALESCE(NULLIF(EXCLUDED.group_name, ''), NULLIF(EXCLUDED.group_name, '(Unknown)'), warranty_master_items.group_name),
            material_group = COALESCE(NULLIF(EXCLUDED.material_group, ''), NULLIF(EXCLUDED.material_group, '(Unknown)'), warranty_master_items.material_group),
            product_subgroup = COALESCE(NULLIF(EXCLUDED.product_subgroup, ''), warranty_master_items.product_subgroup),
            customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), NULLIF(EXCLUDED.customer_name, '(Unknown)'), warranty_master_items.customer_name),
            customer_subgroup = COALESCE(NULLIF(EXCLUDED.customer_subgroup, ''), warranty_master_items.customer_subgroup),
            ship_to_party = COALESCE(NULLIF(EXCLUDED.ship_to_party, ''), warranty_master_items.ship_to_party),
            ship_to_state = COALESCE(NULLIF(EXCLUDED.ship_to_state, ''), warranty_master_items.ship_to_state),
            ship_to_city = COALESCE(NULLIF(EXCLUDED.ship_to_city, ''), warranty_master_items.ship_to_city),
            inventory_number = COALESCE(NULLIF(EXCLUDED.inventory_number, ''), warranty_master_items.inventory_number),
            warr_start_dt = COALESCE(EXCLUDED.warr_start_dt, warranty_master_items.warr_start_dt),
            warr_end_dt = COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt),
            city = COALESCE(NULLIF(EXCLUDED.city, ''), warranty_master_items.city),
            pin_code = COALESCE(NULLIF(EXCLUDED.pin_code, ''), warranty_master_items.pin_code),
            sheet_year = COALESCE(EXCLUDED.sheet_year, warranty_master_items.sheet_year),
            warranty_months = EXCLUDED.warranty_months,
            is_active = (COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) IS NOT NULL AND COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) >= CURRENT_DATE),
            imported_at = NOW()
          WHERE
            (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NOT NULL)
            OR (warranty_master_items.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt >= warranty_master_items.warr_end_dt)
            OR (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NULL);
        `;
        await client.query(sql, params);
      });

      totalImported += valueClauses.length;
    }

    // Keep the persisted flag aligned with the warranty date after every import,
    // including rows that were already in the table before this upload.
    await withAppClient(async (client) => {
      await client.query(`
        UPDATE public.warranty_master_items
        SET is_active = (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
        WHERE is_active IS DISTINCT FROM (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE);
      `);
    });

    const totalCount = await withAppClient(async (client) => {
      const r = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM public.warranty_master_items');
      return Number(r.rows[0]?.count ?? 0);
    });

    return NextResponse.json({
      ok: true,
      importedCount: totalImported,
      totalMachines: totalCount,
      message: `Successfully processed ${totalImported.toLocaleString()} machines`,
    });
  } catch (err) {
    console.error('[warranty-master-import]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
