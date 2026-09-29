import 'server-only';

import { withAppClient } from '@/lib/read-model/db';
import type {
  WarrantyMasterDims,
  WarrantyMasterFgLineRow,
  WarrantyMasterHierarchyGroup,
  WarrantyMasterHierarchySubgroup,
  WarrantyMasterQueryParams,
  WarrantyMasterSerialRow,
  WarrantyMasterSummary,
} from '../services/types';

export type WarrantyMasterDbStats = {
  totalCount: number;
  lastSyncedAt: string | null;
};

export type WarrantyMasterSummaryResult = WarrantyMasterSummary & {
  tableRows: number;
  catalogMachineTotal: number;
};

export type WarrantyMasterHierarchyPage = {
  rows: WarrantyMasterHierarchySubgroup[];
  total: number;
  page: number;
  pageSize: number;
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
 * Legacy — page no longer loads this on open.
 */
export async function queryWarrantyMasterFgLinesFromDb(): Promise<WarrantyMasterFgLineRow[]> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    const res = await client.query<WarrantyMasterFgLineRow>(`
      SELECT
        subgroup_label AS "customerName",
        subgroup_label AS "customerSubgroup",
        group_label AS "groupName",
        subgroup_key AS "customerKey",
        group_key AS "groupKey",
        warranty_months AS "warrantyMonths",
        fg_model AS "fgModel",
        machine_count AS "machineCount",
        active_machine_count AS "activeMachineCount",
        TO_CHAR(min_warr_end, 'YYYY-MM-DD') AS "minWarrEnd",
        TO_CHAR(max_warr_end, 'YYYY-MM-DD') AS "maxWarrEnd"
      FROM public.warranty_master_rollup
      ORDER BY subgroup_label, group_label, warranty_months, fg_model
    `);
    return res.rows;
  });
}

const ROLLUP_DDL = `
CREATE TABLE IF NOT EXISTS public.warranty_master_rollup (
  subgroup_key          text NOT NULL,
  subgroup_label        text NOT NULL,
  group_key             text NOT NULL,
  group_label           text NOT NULL,
  warranty_months       smallint NOT NULL,
  fg_model              text NOT NULL,
  machine_count         integer NOT NULL,
  active_machine_count  integer NOT NULL,
  min_warr_end          date,
  max_warr_end          date,
  PRIMARY KEY (subgroup_key, group_key, warranty_months, fg_model)
);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_subgroup ON public.warranty_master_rollup (subgroup_key);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_group ON public.warranty_master_rollup (group_key);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_fg ON public.warranty_master_rollup (fg_model);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_months ON public.warranty_master_rollup (warranty_months);
`;

type PgClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

let rollupEnsured = false;

async function ensureWarrantyMasterRollup(client: PgClient): Promise<void> {
  await client.query(ROLLUP_DDL);
  if (rollupEnsured) return;
  const cnt = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.warranty_master_rollup`
  );
  if (Number(cnt.rows[0]?.n ?? 0) === 0) {
    await refreshWarrantyMasterRollupWithClient(client);
  }
  rollupEnsured = true;
}

async function refreshWarrantyMasterRollupWithClient(client: PgClient): Promise<void> {
  await client.query(ROLLUP_DDL);
  await client.query(`TRUNCATE public.warranty_master_rollup`);
  await client.query(`
    INSERT INTO public.warranty_master_rollup (
      subgroup_key, subgroup_label, group_key, group_label,
      warranty_months, fg_model, machine_count, active_machine_count,
      min_warr_end, max_warr_end
    )
    SELECT
      LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')) AS subgroup_key,
      MODE() WITHIN GROUP (
        ORDER BY COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')
      ) AS subgroup_label,
      LOWER(COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')) AS group_key,
      MODE() WITHIN GROUP (
        ORDER BY COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')
      ) AS group_label,
      warranty_months,
      COALESCE(NULLIF(BTRIM(fg_model), ''), '(Unknown)') AS fg_model,
      COUNT(*)::int AS machine_count,
      SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)::int
        AS active_machine_count,
      MIN(warr_end_dt) AS min_warr_end,
      MAX(warr_end_dt) AS max_warr_end
    FROM public.warranty_master_items
    GROUP BY
      LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
      LOWER(COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
      warranty_months,
      COALESCE(NULLIF(BTRIM(fg_model), ''), '(Unknown)')
  `);
}

/** Rebuild rollup after Excel import (or empty table). One 5M scan, then reports are cheap. */
export async function refreshWarrantyMasterRollup(): Promise<void> {
  await withAppClient(async (client) => {
    await refreshWarrantyMasterRollupWithClient(client);
    rollupEnsured = true;
  });
}

/** Rollup WHERE — case-folded keys; date filters use end-date range overlap. */
function buildRollupFilterWhere(params: WarrantyMasterQueryParams): {
  sql: string;
  values: unknown[];
  countExpr: string;
} {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;
  const activeOnly = Boolean(params.activeOnly);
  const countExpr = activeOnly ? 'active_machine_count' : 'machine_count';

  if (params.customer?.trim()) {
    const keys = params.customer.split(',').map((s) => s.trim()).filter(Boolean);
    if (keys.length > 0) {
      conditions.push(
        `subgroup_key = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
      );
      values.push(keys);
      idx++;
    }
  }

  if (params.group?.trim()) {
    const keys = params.group.split(',').map((s) => s.trim()).filter(Boolean);
    if (keys.length > 0) {
      conditions.push(
        `group_key = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
      );
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
    const months = params.warrantyMonths
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite);
    if (months.length > 0) {
      conditions.push(`warranty_months = ANY($${idx}::int[])`);
      values.push(months);
      idx++;
    }
  }

  if (activeOnly) {
    conditions.push(`active_machine_count > 0`);
  }
  if (params.warrEndFrom?.trim()) {
    conditions.push(`max_warr_end IS NOT NULL AND max_warr_end >= $${idx}::date`);
    values.push(params.warrEndFrom.trim());
    idx++;
  }
  if (params.warrEndTo?.trim()) {
    conditions.push(`min_warr_end IS NOT NULL AND min_warr_end <= $${idx}::date`);
    values.push(params.warrEndTo.trim());
    idx++;
  }

  return { sql: conditions.join(' AND '), values, countExpr };
}

/** KPI counts for the current filter window — from rollup. */
export async function queryWarrantyMasterSummaryFromDb(
  params: WarrantyMasterQueryParams
): Promise<WarrantyMasterSummaryResult> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    const { sql: whereSql, values, countExpr } = buildRollupFilterWhere(params);

    const catalogRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(machine_count), 0)::text AS total FROM public.warranty_master_rollup`
    );
    const catalogMachineTotal = Number(catalogRes.rows[0]?.total ?? 0);

    const res = await client.query<{
      total_machines: number;
      distinct_customers: number;
      distinct_groups: number;
      table_rows: number;
    }>(
      `
      SELECT
        COALESCE(SUM(${countExpr}), 0)::int AS total_machines,
        COUNT(DISTINCT subgroup_key)::int AS distinct_customers,
        COUNT(DISTINCT group_key)::int AS distinct_groups,
        COUNT(DISTINCT subgroup_key)::int AS table_rows
      FROM public.warranty_master_rollup
      WHERE ${whereSql}
      `,
      values
    );
    const row = res.rows[0];
    return {
      totalMachines: Number(row?.total_machines ?? 0),
      distinctCustomers: Number(row?.distinct_customers ?? 0),
      distinctGroups: Number(row?.distinct_groups ?? 0),
      tableRows: Number(row?.table_rows ?? 0),
      catalogMachineTotal,
    };
  });
}

/** Filter dropdown values from rollup (tiny). */
export async function queryWarrantyMasterOptionsFromDb(): Promise<WarrantyMasterDims> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    const [customers, groups, fgModels, months] = await Promise.all([
      client.query<{ val: string; label: string }>(`
        SELECT subgroup_key AS val, MIN(subgroup_label) AS label
        FROM public.warranty_master_rollup
        GROUP BY subgroup_key
        ORDER BY 2
      `),
      client.query<{ val: string; label: string }>(`
        SELECT group_key AS val, MIN(group_label) AS label
        FROM public.warranty_master_rollup
        GROUP BY group_key
        ORDER BY 2
      `),
      client.query<{ val: string }>(`
        SELECT DISTINCT fg_model AS val
        FROM public.warranty_master_rollup
        WHERE fg_model <> ''
        ORDER BY 1
      `),
      client.query<{ val: number }>(`
        SELECT DISTINCT warranty_months AS val
        FROM public.warranty_master_rollup
        ORDER BY 1
      `),
    ]);

    return {
      customers: customers.rows.map((r) => ({ value: r.label, label: r.label })),
      groups: groups.rows.map((r) => ({ value: r.label, label: r.label })),
      fgModels: fgModels.rows.map((r) => ({ value: r.val, label: r.val })),
      warrantyMonths: months.rows.map((r) => Number(r.val)).filter(Number.isFinite),
    };
  });
}

type HierarchyFlatRow = {
  subgroupKey: string;
  subgroup: string;
  groupKey: string;
  groupName: string;
  warrantyMonths: number;
  machineCount: number;
  minWarrEnd: string | null;
  maxWarrEnd: string | null;
};

/** One page of customer subgroups with nested groups → warranties — from rollup. */
export async function queryWarrantyMasterHierarchyFromDb(
  params: WarrantyMasterQueryParams & {
    page?: number;
    pageSize?: number;
    sortDir?: 'asc' | 'desc';
  }
): Promise<WarrantyMasterHierarchyPage> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(10, params.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const sortDir = params.sortDir === 'desc' ? 'DESC' : 'ASC';
    const { sql: whereSql, values, countExpr } = buildRollupFilterWhere(params);

    const countRes = await client.query<{ total: number }>(
      `
      SELECT COUNT(*)::int AS total FROM (
        SELECT subgroup_key
        FROM public.warranty_master_rollup
        WHERE ${whereSql}
        GROUP BY subgroup_key
      ) t
      `,
      values
    );
    const total = Number(countRes.rows[0]?.total ?? 0);
    if (total === 0) {
      return { rows: [], total: 0, page, pageSize };
    }

    const limitIdx = values.length + 1;
    const offsetIdx = values.length + 2;
    const detailRes = await client.query<HierarchyFlatRow>(
      `
      WITH page_subgroups AS (
        SELECT subgroup_key, MIN(subgroup_label) AS subgroup_label
        FROM public.warranty_master_rollup
        WHERE ${whereSql}
        GROUP BY subgroup_key
        ORDER BY MIN(subgroup_label) ${sortDir}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      )
      SELECT
        r.subgroup_key AS "subgroupKey",
        p.subgroup_label AS "subgroup",
        r.group_key AS "groupKey",
        MIN(r.group_label) AS "groupName",
        r.warranty_months AS "warrantyMonths",
        SUM(r.${countExpr})::int AS "machineCount",
        TO_CHAR(MIN(r.min_warr_end), 'YYYY-MM-DD') AS "minWarrEnd",
        TO_CHAR(MAX(r.max_warr_end), 'YYYY-MM-DD') AS "maxWarrEnd"
      FROM public.warranty_master_rollup r
      INNER JOIN page_subgroups p ON p.subgroup_key = r.subgroup_key
      WHERE ${whereSql}
      GROUP BY r.subgroup_key, p.subgroup_label, r.group_key, r.warranty_months
      HAVING SUM(r.${countExpr}) > 0
      ORDER BY p.subgroup_label ${sortDir}, MIN(r.group_label) ASC, r.warranty_months ASC
      `,
      [...values, pageSize, offset]
    );

    const subgroupMap = new Map<string, WarrantyMasterHierarchySubgroup>();
    for (const row of detailRes.rows) {
      let subgroup = subgroupMap.get(row.subgroupKey);
      if (!subgroup) {
        subgroup = {
          subgroupKey: row.subgroupKey,
          customerSubgroup: row.subgroup,
          machineCount: 0,
          groups: [],
        };
        subgroupMap.set(row.subgroupKey, subgroup);
      }
      subgroup.machineCount += row.machineCount;

      let group = subgroup.groups.find((g) => g.groupKey === row.groupKey);
      if (!group) {
        group = {
          groupKey: row.groupKey,
          groupName: row.groupName,
          machineCount: 0,
          warranties: [],
        };
        subgroup.groups.push(group);
      }
      group.machineCount += row.machineCount;
      group.warranties.push({
        warrantyMonths: Number(row.warrantyMonths),
        machineCount: row.machineCount,
        minWarrEnd: row.minWarrEnd,
        maxWarrEnd: row.maxWarrEnd,
      });
    }

    const order = [...new Set(detailRes.rows.map((r) => r.subgroupKey))];
    const rows: WarrantyMasterHierarchySubgroup[] = order
      .map((key) => subgroupMap.get(key))
      .filter((r): r is WarrantyMasterHierarchySubgroup => Boolean(r))
      .map((subgroup) => ({
        ...subgroup,
        groups: subgroup.groups.map((g): WarrantyMasterHierarchyGroup => ({
          ...g,
          warranties: [...g.warranties].sort((a, b) => a.warrantyMonths - b.warrantyMonths),
        })),
      }));

    return { rows, total, page, pageSize };
  });
}

