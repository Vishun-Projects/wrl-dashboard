import ExcelJS from 'exceljs';
import { withAppClient } from '@/lib/read-model/db';
import { fyLabel, fyStartYear, warrantyEndIso } from '@/modules/warranty-provision/fy';

/** Canonical headers (input cols only — Excel formula cols ignored). */
export const UNITS_TEMPLATE_HEADERS = [
  'Billing Document',
  'Billing Date',
  'Material',
  'Serial Number',
  'Material Group',
  'External Material Group',
  'Customer Sold to Party Name',
  'Customer Sub Group',
  'Customer Ship to Party Name',
  'Ship to Party State',
  'Ship to Party City',
  'Inventory Number',
  'Warranty',
  'Days',
] as const;

const HEADERS: Record<string, string> = {
  billingdocument: 'billing',
  billingdate: 'billing_date',
  material: 'material',
  serialnumber: 'serial',
  materialgroup: 'material_group',
  externalmaterialgroup: 'external_material_group',
  customersoldtopartyname: 'sold_to',
  soldtopartyname: 'sold_to',
  customersubgroup: 'subgroup',
  customershiptopartyname: 'ship_to',
  shiptopartyname: 'ship_to',
  shiptopartystate: 'state',
  shiptopartycity: 'city',
  inventorynumber: 'inventory',
  warranty: 'warranty_start',
  warrantystart: 'warranty_start',
  days: 'days',
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellText((v as { result: unknown }).result);
  }
  if (typeof v === 'object' && v !== null && 'text' in v) {
    return String((v as { text: unknown }).text ?? '').trim();
  }
  if (v instanceof Date) return '';
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 100000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return cellDate(new Date(ms));
  }
  const s = cellText(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

function cellInt(v: unknown): number | null {
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return cellInt((v as { result: unknown }).result);
  }
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type UnitParseRow = {
  billingDocument: string;
  billingDate: string | null;
  material: string;
  serialNumber: string;
  materialGroup: string;
  externalMaterialGroup: string;
  soldToPartyName: string;
  customerSubgroup: string;
  shipToPartyName: string;
  shipToPartyState: string;
  shipToPartyCity: string;
  inventoryNumber: string;
  warrantyStart: string | null;
  days: number | null;
  error?: string;
};

export async function parseUnitsWorkbook(buf: Buffer): Promise<{
  rows: UnitParseRow[];
  errors: UnitParseRow[];
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet');

  const map: Record<string, number> = {};
  ws.getRow(1).eachCell((c, i) => {
    const k = HEADERS[norm(cellText(c.value))];
    if (k) map[k] = i;
  });
  if (!map.billing || !map.warranty_start || !map.days) {
    throw new Error('Need Billing Document, Warranty, and Days columns');
  }

  const rows: UnitParseRow[] = [];
  const errors: UnitParseRow[] = [];
  const seen = new Set<string>();

  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const g = (k: string) => (map[k] ? row.getCell(map[k]).value : null);
    const billingDocument = cellText(g('billing'));
    const serialNumber = cellText(g('serial'));
    if (!billingDocument && !serialNumber) return;

    const rec: UnitParseRow = {
      billingDocument,
      billingDate: cellDate(g('billing_date')),
      material: cellText(g('material')),
      serialNumber,
      materialGroup: cellText(g('material_group')),
      externalMaterialGroup: cellText(g('external_material_group')),
      soldToPartyName: cellText(g('sold_to')),
      customerSubgroup: cellText(g('subgroup')),
      shipToPartyName: cellText(g('ship_to')),
      shipToPartyState: cellText(g('state')),
      shipToPartyCity: cellText(g('city')),
      inventoryNumber: cellText(g('inventory')),
      warrantyStart: cellDate(g('warranty_start')),
      days: cellInt(g('days')),
    };

    const err: string[] = [];
    if (!billingDocument) err.push('Billing Document missing');
    if (!serialNumber) err.push('Serial missing');
    if (!rec.warrantyStart) err.push('Warranty start missing/invalid');
    if (rec.days == null) err.push('Days missing');
    const key = `${billingDocument}\0${serialNumber}`;
    if (billingDocument && serialNumber && seen.has(key)) {
      err.push('Duplicate Billing Document + Serial in file');
    }
    if (err.length) {
      errors.push({ ...rec, error: err.join('; ') });
      return;
    }
    seen.add(key);
    rows.push(rec);
  });

  return { rows, errors };
}

const BATCH = 500;

export async function commitUnits(rows: UnitParseRow[]): Promise<{
  upserted: number;
}> {
  return withAppClient(async (client) => {
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const r of chunk) {
        const end =
          r.warrantyStart != null && r.days != null
            ? warrantyEndIso(r.warrantyStart, r.days)
            : null;
        const endFy = end ? fyLabel(fyStartYear(end)) : '';
        const billingYear = r.billingDate ? Number(r.billingDate.slice(0, 4)) : null;
        placeholders.push(
          `($${p++},$${p++}::date,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++}::date,$${p++}::date,$${p++},$${p++})`
        );
        values.push(
          r.billingDocument,
          r.billingDate,
          billingYear,
          r.material,
          r.serialNumber,
          r.materialGroup,
          r.externalMaterialGroup,
          r.soldToPartyName,
          r.customerSubgroup,
          r.shipToPartyName,
          r.shipToPartyState,
          r.shipToPartyCity,
          r.inventoryNumber,
          r.warrantyStart,
          end,
          r.days,
          endFy
        );
      }
      await client.query(
        `
        INSERT INTO warranty_provision_rows (
          billing_document, billing_date, billing_year, material, serial_number,
          material_group, external_material_group, sold_to_party_name, customer_subgroup,
          ship_to_party_name, ship_to_party_state, ship_to_party_city, inventory_number,
          warranty_start, warranty_end_date, days, warranty_end_fy
        ) VALUES ${placeholders.join(',')}
        ON CONFLICT (billing_document, serial_number)
        WHERE billing_document <> '' AND serial_number <> ''
        DO UPDATE SET
          billing_date = EXCLUDED.billing_date,
          billing_year = EXCLUDED.billing_year,
          material = EXCLUDED.material,
          material_group = EXCLUDED.material_group,
          external_material_group = EXCLUDED.external_material_group,
          sold_to_party_name = EXCLUDED.sold_to_party_name,
          customer_subgroup = EXCLUDED.customer_subgroup,
          ship_to_party_name = EXCLUDED.ship_to_party_name,
          ship_to_party_state = EXCLUDED.ship_to_party_state,
          ship_to_party_city = EXCLUDED.ship_to_party_city,
          inventory_number = EXCLUDED.inventory_number,
          warranty_start = EXCLUDED.warranty_start,
          warranty_end_date = EXCLUDED.warranty_end_date,
          days = EXCLUDED.days,
          warranty_end_fy = EXCLUDED.warranty_end_fy
        `,
        values
      );
      upserted += chunk.length;
    }
    return { upserted };
  });
}
