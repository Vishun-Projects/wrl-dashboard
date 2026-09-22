import 'server-only';

import { withAppClient } from '@/lib/read-model/db';
import type {
  WarrantyMasterFgLineRow,
  WarrantyMasterQueryParams,
  WarrantyMasterSerialRow,
} from '../services/types';

export type WarrantyMasterDbStats = {
  totalCount: number;
  lastSyncedAt: string | null;
};

/**
 * Check whether warranty_master_items has been populated in Postgres.
 */
export async function getWarrantyMasterDbStats(): Promise<WarrantyMasterDbStats> {
  try {
    return await withAppClient(async (client) => {
      const res = await client.query<{ total: string; last_synced: string | null }>(`
        SELECT
          COUNT(*)::text AS total,
          MAX(imported_at)::text AS last_synced
        FROM public.warranty_master_items
      `);
      const row = res.rows[0];
      return {
        totalCount: Number(row?.total ?? 0),
        lastSyncedAt: row?.last_synced ?? null,
      };
    });
  } catch {
    return { totalCount: 0, lastSyncedAt: null };
  }
}

/**
 * Query matching machine serial numbers directly from Postgres.
 */
export async function queryWarrantyMasterSerialsFromDb(
  params: WarrantyMasterQueryParams & {
    customerKey?: string;
    customerSubgroup?: string;
    groupKey?: string;
    rowWarrantyMonths?: number;
    limit?: number;
    offset?: number;
  }
): Promise<WarrantyMasterSerialRow[]> {
  return withAppClient(async (client) => {
    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let idx = 1;

    const serial = (params.serialNumber ?? params.q)?.trim();
    if (serial) {
      conditions.push(`serial_no ILIKE $${idx}`);
      values.push(`%${serial}%`);
      idx++;
    }

    if (params.customerSubgroup?.trim()) {
      conditions.push(`LOWER(BTRIM(customer_subgroup)) = LOWER(BTRIM($${idx}))`);
      values.push(params.customerSubgroup.trim());
      idx++;
    } else if (params.customerKey?.trim()) {
      conditions.push(`(
        LOWER(BTRIM(customer_name)) = LOWER(BTRIM($${idx}))
        OR LOWER(BTRIM(customer_subgroup)) = LOWER(BTRIM($${idx}))
      )`);
      values.push(params.customerKey.trim());
      idx++;
    } else if (params.customer?.trim()) {
      const keys = params.customer.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`(
          LOWER(BTRIM(customer_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
          OR LOWER(BTRIM(customer_subgroup)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
        )`);
        values.push(keys);
        idx++;
      }
    }

    if (params.groupKey?.trim()) {
      conditions.push(`LOWER(BTRIM(group_name)) = LOWER(BTRIM($${idx}))`);
      values.push(params.groupKey.trim());
      idx++;
    } else if (params.group?.trim()) {
      const keys = params.group.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`LOWER(BTRIM(group_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`);
        values.push(keys);
        idx++;
      }
    }

    if (params.fgModel?.trim()) {
      const models = params.fgModel.split(',').map((s) => s.trim()).filter(Boolean);
      if (models.length > 0) {
        conditions.push(`fg_model = ANY($${idx})`);
        values.push(models);
        idx++;
      }
    }

    const months = params.rowWarrantyMonths ?? (params.warrantyMonths ? Number(params.warrantyMonths) : NaN);
    if (Number.isFinite(months)) {
      conditions.push(`warranty_months = $${idx}`);
      values.push(months);
      idx++;
    }

    if (params.activeOnly) {
      conditions.push(`warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE`);
    }

    if (params.warrEndFrom?.trim()) {
      conditions.push(`warr_end_dt >= $${idx}::date`);
      values.push(params.warrEndFrom.trim());
      idx++;
    }
    if (params.warrEndTo?.trim()) {
      conditions.push(`warr_end_dt <= $${idx}::date`);
      values.push(params.warrEndTo.trim());
      idx++;
    }

    const limit = Math.min(Math.max(params.limit ?? 250, 1), 500);
    const offset = Math.max(params.offset ?? 0, 0);
    const sql = `
      SELECT
        id::text AS ncode,
        serial_no AS "serialNo",
        customer_name AS "customerName",
        customer_subgroup AS "customerSubgroup",
        customer_name AS "customerKey",
        group_name AS "groupName",
        group_name AS "groupKey",
        fg_model AS "fgModel",
        warranty_months AS "warrantyMonths",
        TO_CHAR(warr_start_dt, 'YYYY-MM-DD') AS "warrStartDt",
        TO_CHAR(warr_end_dt, 'YYYY-MM-DD') AS "warrEndDt",
        (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE) AS "isActive",
        billing_doc AS "billingDoc",
        TO_CHAR(billing_date, 'YYYY-MM-DD') AS "billingDate",
        ship_to_party AS "shipToParty",
        ship_to_state AS "shipToState",
        ship_to_city AS "shipToCity",
        inventory_number AS "inventoryNumber",
        city AS "city",
        pin_code AS "pinCode",
        sheet_year AS "sheetYear"
      FROM public.warranty_master_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY serial_no ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const res = await client.query<WarrantyMasterSerialRow>(sql, values);
    return res.rows;
  });
}

export async function countWarrantyMasterSerialsFromDb(
  params: WarrantyMasterQueryParams & {
    customerKey?: string;
    customerSubgroup?: string;
    groupKey?: string;
    rowWarrantyMonths?: number;
  }
): Promise<number> {
  return withAppClient(async (client) => {
    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let idx = 1;

    const serial = (params.serialNumber ?? params.q)?.trim();
    if (serial) {
      conditions.push(`serial_no ILIKE $${idx}`);
      values.push(`%${serial}%`);
      idx++;
    }

    if (params.customerSubgroup?.trim()) {
      conditions.push(`LOWER(BTRIM(customer_subgroup)) = LOWER(BTRIM($${idx}))`);
      values.push(params.customerSubgroup.trim());
      idx++;
    } else if (params.customerKey?.trim()) {
      conditions.push(`(
        LOWER(BTRIM(customer_name)) = LOWER(BTRIM($${idx}))
        OR LOWER(BTRIM(customer_subgroup)) = LOWER(BTRIM($${idx}))
      )`);
      values.push(params.customerKey.trim());
      idx++;
    } else if (params.customer?.trim()) {
      const keys = params.customer.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`(
          LOWER(BTRIM(customer_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
          OR LOWER(BTRIM(customer_subgroup)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
        )`);
        values.push(keys);
        idx++;
      }
    }

    if (params.groupKey?.trim()) {
      conditions.push(`LOWER(BTRIM(group_name)) = LOWER(BTRIM($${idx}))`);
      values.push(params.groupKey.trim());
      idx++;
    } else if (params.group?.trim()) {
      const keys = params.group.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`LOWER(BTRIM(group_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`);
        values.push(keys);
        idx++;
      }
    }

    if (params.fgModel?.trim()) {
      const models = params.fgModel.split(',').map((s) => s.trim()).filter(Boolean);
      if (models.length > 0) {
        conditions.push(`fg_model = ANY($${idx})`);
        values.push(models);
        idx++;
      }
    }

    const months = params.rowWarrantyMonths ?? (params.warrantyMonths ? Number(params.warrantyMonths) : NaN);
    if (Number.isFinite(months)) {
      conditions.push(`warranty_months = $${idx}`);
      values.push(months);
      idx++;
    }

    if (params.activeOnly) {
      conditions.push(`warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE`);
    }
    if (params.warrEndFrom?.trim()) {
      conditions.push(`warr_end_dt >= $${idx}::date`);
      values.push(params.warrEndFrom.trim());
      idx++;
    }
    if (params.warrEndTo?.trim()) {
      conditions.push(`warr_end_dt <= $${idx}::date`);
      values.push(params.warrEndTo.trim());
      idx++;
    }

    const sql = `SELECT COUNT(*)::int AS count FROM public.warranty_master_items WHERE ${conditions.join(' AND ')}`;
    const res = await client.query<{ count: number }>(sql, values);
    return Number(res.rows[0]?.count ?? 0);
  });
}

/**
 * Fetch the complete, row-level Warranty Master dataset for CSV export.
 * Unlike the paginated serial endpoint, this intentionally returns every
 * matching imported machine with all persisted import fields.
 */
export async function queryWarrantyMasterExportRowsFromDb(
  params: WarrantyMasterQueryParams
): Promise<import('../services/types').WarrantyMasterExportRow[]> {
  return withAppClient(async (client) => {
    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let idx = 1;

    const serial = (params.serialNumber ?? params.q)?.trim();
    if (serial) {
      conditions.push(`serial_no ILIKE $${idx}`);
      values.push(`%${serial}%`);
      idx++;
    }

    if (params.customer?.trim()) {
      const keys = params.customer.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`(
          LOWER(BTRIM(customer_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
          OR LOWER(BTRIM(customer_subgroup)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)
        )`);
        values.push(keys);
        idx++;
      }
    }

    if (params.group?.trim()) {
      const keys = params.group.split(',').map((s) => s.trim()).filter(Boolean);
      if (keys.length > 0) {
        conditions.push(`LOWER(BTRIM(group_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`);
        values.push(keys);
        idx++;
      }
    }

    if (params.fgModel?.trim()) {
      const models = params.fgModel.split(',').map((s) => s.trim()).filter(Boolean);
      if (models.length > 0) {
        conditions.push(`fg_model = ANY($${idx})`);
        values.push(models);
        idx++;
      }
    }

    if (params.warrantyMonths?.trim()) {
      const months = params.warrantyMonths.split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
      if (months.length > 0) {
        conditions.push(`warranty_months = ANY($${idx}::int[])`);
        values.push(months);
        idx++;
      }
    }

    if (params.activeOnly) {
      conditions.push(`warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE`);
    }
    if (params.warrStartFrom?.trim()) {
      conditions.push(`warr_start_dt >= $${idx}::date`);
      values.push(params.warrStartFrom.trim());
      idx++;
    }
    if (params.warrStartTo?.trim()) {
      conditions.push(`warr_start_dt <= $${idx}::date`);
      values.push(params.warrStartTo.trim());
      idx++;
    }
    if (params.warrEndFrom?.trim()) {
      conditions.push(`warr_end_dt >= $${idx}::date`);
      values.push(params.warrEndFrom.trim());
      idx++;
    }
    if (params.warrEndTo?.trim()) {
      conditions.push(`warr_end_dt <= $${idx}::date`);
      values.push(params.warrEndTo.trim());
      idx++;
    }

    const sql = `
      SELECT
        billing_doc AS "billingDoc",
        TO_CHAR(billing_date, 'YYYY-MM-DD') AS "billingDate",
        material AS "material",
        serial_no AS "serialNo",
        group_name AS "groupName",
        material_group AS "materialGroup",
        product_subgroup AS "productSubgroup",
        customer_name AS "customerName",
        customer_subgroup AS "customerSubgroup",
        ship_to_party AS "shipToParty",
        ship_to_state AS "shipToState",
        ship_to_city AS "shipToCity",
        inventory_number AS "inventoryNumber",
        TO_CHAR(warr_start_dt, 'YYYY-MM-DD') AS "warrStartDt",
        TO_CHAR(warr_end_dt, 'YYYY-MM-DD') AS "warrEndDt",
        city AS "city",
        pin_code AS "pinCode",
        sheet_year AS "sheetYear",
        warranty_months AS "warrantyMonths",
        (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE) AS "isActive"
      FROM public.warranty_master_items
      WHERE ${conditions.join(' AND ')}
      ORDER BY serial_no ASC
    `;

    const res = await client.query<import('../services/types').WarrantyMasterExportRow>(sql, values);
    return res.rows;
  });
}

/**
 * Fetch full FG-line dataset aggregated directly inside Postgres.
 */
export async function queryWarrantyMasterFgLinesFromDb(): Promise<WarrantyMasterFgLineRow[]> {
  return withAppClient(async (client) => {
    const res = await client.query<WarrantyMasterFgLineRow>(`
      SELECT
        customer_name AS "customerName",
        COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)') AS "customerSubgroup",
        group_name AS "groupName",
        customer_name AS "customerKey",
        group_name AS "groupKey",
        warranty_months AS "warrantyMonths",
        fg_model AS "fgModel",
        COUNT(*)::int AS "machineCount",
        SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)::int AS "activeMachineCount",
        TO_CHAR(MIN(warr_end_dt), 'YYYY-MM-DD') AS "minWarrEnd",
        TO_CHAR(MAX(warr_end_dt), 'YYYY-MM-DD') AS "maxWarrEnd"
      FROM public.warranty_master_items
      GROUP BY
        customer_name,
        COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)'),
        group_name,
        warranty_months,
        fg_model
      ORDER BY "customerSubgroup", "groupName", "warrantyMonths", "fgModel"
    `);
    return res.rows;
  });
}
