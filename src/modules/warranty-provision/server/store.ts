import { withAppClient } from '@/lib/read-model/db';
import type {
  WarrantyProvisionOptions,
  WarrantyProvisionRow,
  WarrantyProvisionRowsResponse,
} from '@/modules/warranty-provision/types';

export type WarrantyProvisionFilters = {
  materialGroups: string[];
  customerSubgroups: string[];
  states: string[];
  cities: string[];
  materials: string[];
  warrantyRemainingDays: string[];
  warrantyEndFys: string[];
  q: string;
  billingFrom: string;
  billingTo: string;
  page: number;
  pageSize: number;
};

function buildWhere(
  filters: Omit<WarrantyProvisionFilters, 'page' | 'pageSize'>,
  startIdx = 1
): { sql: string; values: unknown[]; next: number } {
  const conds: string[] = ['1=1'];
  const values: unknown[] = [];
  let i = startIdx;

  if (filters.materialGroups.length) {
    conds.push(`material_group = ANY($${i++}::text[])`);
    values.push(filters.materialGroups);
  }
  if (filters.customerSubgroups.length) {
    conds.push(`customer_subgroup = ANY($${i++}::text[])`);
    values.push(filters.customerSubgroups);
  }
  if (filters.states.length) {
    conds.push(`ship_to_party_state = ANY($${i++}::text[])`);
    values.push(filters.states);
  }
  if (filters.cities.length) {
    conds.push(`ship_to_party_city = ANY($${i++}::text[])`);
    values.push(filters.cities);
  }
  if (filters.materials.length) {
    conds.push(`material = ANY($${i++}::text[])`);
    values.push(filters.materials);
  }
  if (filters.warrantyRemainingDays.length) {
    conds.push(`warranty_remaining_days = ANY($${i++}::text[])`);
    values.push(filters.warrantyRemainingDays);
  }
  if (filters.warrantyEndFys.length) {
    conds.push(`warranty_end_fy = ANY($${i++}::text[])`);
    values.push(filters.warrantyEndFys);
  }
  if (filters.billingFrom) {
    conds.push(`billing_date >= $${i++}::date`);
    values.push(filters.billingFrom);
  }
  if (filters.billingTo) {
    conds.push(`billing_date <= $${i++}::date`);
    values.push(filters.billingTo);
  }
  const q = filters.q.trim();
  if (q) {
    conds.push(
      `(billing_document ILIKE $${i} OR serial_number ILIKE $${i} OR sold_to_party_name ILIKE $${i} OR ship_to_party_name ILIKE $${i} OR inventory_number ILIKE $${i})`
    );
    values.push(`%${q}%`);
    i += 1;
  }

  return { sql: conds.join(' AND '), values, next: i };
}

/** pg `date` → YYYY-MM-DD (local calendar). Never String(date).slice / toISOString. */
function pgDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function mapRow(r: Record<string, unknown>): WarrantyProvisionRow {
  return {
    id: Number(r.id) || 0,
    billingDocument: String(r.billing_document ?? ''),
    billingDate: pgDate(r.billing_date),
    material: String(r.material ?? ''),
    serialNumber: String(r.serial_number ?? ''),
    materialGroup: String(r.material_group ?? ''),
    externalMaterialGroup: String(r.external_material_group ?? ''),
    soldToPartyName: String(r.sold_to_party_name ?? ''),
    customerSubgroup: String(r.customer_subgroup ?? ''),
    shipToPartyName: String(r.ship_to_party_name ?? ''),
    shipToPartyState: String(r.ship_to_party_state ?? ''),
    shipToPartyCity: String(r.ship_to_party_city ?? ''),
    inventoryNumber: String(r.inventory_number ?? ''),
    warrantyStart: pgDate(r.warranty_start),
    warrantyEndDate: pgDate(r.warranty_end_date),
    days: r.days == null || r.days === '' ? null : Number(r.days),
    remainingDays: r.remaining_days == null || r.remaining_days === '' ? null : Number(r.remaining_days),
    warrantyRemainingDays: String(r.warranty_remaining_days ?? ''),
    warrantyEndFy: String(r.warranty_end_fy ?? ''),
  };
}

export async function fetchWarrantyProvisionOptions(): Promise<WarrantyProvisionOptions> {
  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      material_groups: string[] | null;
      customer_subgroups: string[] | null;
      states: string[] | null;
      cities: string[] | null;
      materials: string[] | null;
      warranty_remaining_days: string[] | null;
      warranty_end_fys: string[] | null;
    }>(`
      SELECT
        ARRAY(SELECT DISTINCT material_group FROM warranty_provision_rows WHERE material_group <> '' ORDER BY 1) AS material_groups,
        ARRAY(SELECT DISTINCT customer_subgroup FROM warranty_provision_rows WHERE customer_subgroup <> '' ORDER BY 1) AS customer_subgroups,
        ARRAY(SELECT DISTINCT ship_to_party_state FROM warranty_provision_rows WHERE ship_to_party_state <> '' ORDER BY 1) AS states,
        ARRAY(SELECT DISTINCT ship_to_party_city FROM warranty_provision_rows WHERE ship_to_party_city <> '' ORDER BY 1 LIMIT 2000) AS cities,
        ARRAY(SELECT DISTINCT material FROM warranty_provision_rows WHERE material <> '' ORDER BY 1 LIMIT 2000) AS materials,
        ARRAY(SELECT DISTINCT warranty_remaining_days FROM warranty_provision_rows WHERE warranty_remaining_days <> '' ORDER BY 1) AS warranty_remaining_days,
        ARRAY(SELECT DISTINCT warranty_end_fy FROM warranty_provision_rows WHERE warranty_end_fy <> '' ORDER BY 1) AS warranty_end_fys
    `);
    const r = rows[0] ?? {};
    return {
      materialGroups: r.material_groups ?? [],
      customerSubgroups: r.customer_subgroups ?? [],
      states: r.states ?? [],
      cities: r.cities ?? [],
      materials: r.materials ?? [],
      warrantyRemainingDays: r.warranty_remaining_days ?? [],
      warrantyEndFys: r.warranty_end_fys ?? [],
    };
  });
}

export async function queryWarrantyProvisionRows(
  filters: WarrantyProvisionFilters
): Promise<WarrantyProvisionRowsResponse> {
  return withAppClient(async (client) => {
    const { sql, values, next } = buildWhere(filters);
    const countRes = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM warranty_provision_rows WHERE ${sql}`,
      values
    );
    const total = Number(countRes.rows[0]?.n ?? 0) || 0;
    const offset = (filters.page - 1) * filters.pageSize;
    const pageRes = await client.query(
      `
      SELECT *
      FROM warranty_provision_rows
      WHERE ${sql}
      ORDER BY billing_date DESC NULLS LAST, id DESC
      LIMIT $${next} OFFSET $${next + 1}
      `,
      [...values, filters.pageSize, offset]
    );
    return {
      rows: pageRes.rows.map((r) => mapRow(r as Record<string, unknown>)),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}
