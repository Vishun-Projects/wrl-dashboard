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
type ItemsFilterParams = WarrantyMasterQueryParams & {
  customerKey?: string;
  customerSubgroup?: string;
  groupKey?: string;
  rowWarrantyMonths?: number;
};

function splitCsvParam(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Shared WHERE for warranty_master_items (serials / export / sold-to-aware KPIs). */
function buildItemsFilterWhere(params: ItemsFilterParams): {
  sql: string;
  values: unknown[];
} {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  const serial = (params.serialNumber ?? params.q)?.trim();
  if (serial) {
    conditions.push(`serial_no ILIKE $${idx}`);
    values.push(`%${serial}%`);
    idx++;
  }

  const soldTo = splitCsvParam(params.soldTo);
  if (soldTo.length > 0) {
    conditions.push(
      `LOWER(BTRIM(customer_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
    );
    values.push(soldTo);
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
  } else {
    const subgroups = splitCsvParam(params.customer);
    if (subgroups.length > 0) {
      conditions.push(
        `LOWER(BTRIM(customer_subgroup)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
      );
      values.push(subgroups);
      idx++;
    }
  }

  if (params.groupKey?.trim()) {
    conditions.push(`LOWER(BTRIM(group_name)) = LOWER(BTRIM($${idx}))`);
    values.push(params.groupKey.trim());
    idx++;
  } else {
    const groups = splitCsvParam(params.group);
    if (groups.length > 0) {
      conditions.push(
        `LOWER(BTRIM(group_name)) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
      );
      values.push(groups);
      idx++;
    }
  }

  const models = splitCsvParam(params.fgModel);
  if (models.length > 0) {
    conditions.push(
      `LOWER(COALESCE(NULLIF(BTRIM(material), ''), '(Unknown)')) = ANY(SELECT LOWER(BTRIM(x)) FROM unnest($${idx}::text[]) AS x)`
    );
    values.push(models);
    idx++;
  }

  if (params.rowWarrantyMonths != null && Number.isFinite(params.rowWarrantyMonths)) {
    conditions.push(`warranty_months = $${idx}`);
    values.push(params.rowWarrantyMonths);
    idx++;
  } else {
    const months = splitCsvParam(params.warrantyMonths)
      .map((s) => Number(s))
      .filter(Number.isFinite);
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

  return { sql: conditions.join(' AND '), values };
}

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
    const { sql: whereSql, values } = buildItemsFilterWhere(params);
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
        material AS "fgModel",
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
        pin_code AS "pinCode"
      FROM public.warranty_master_items
      WHERE ${whereSql}
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
    const { sql: whereSql, values } = buildItemsFilterWhere(params);
    const sql = `SELECT COUNT(*)::int AS count FROM public.warranty_master_items WHERE ${whereSql}`;
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
    const { sql: whereSql, values } = buildItemsFilterWhere(params);
    const sql = `
      SELECT
        billing_doc AS "billingDoc",
        TO_CHAR(billing_date, 'YYYY-MM-DD') AS "billingDate",
        material AS "material",
        serial_no AS "serialNo",
        group_name AS "groupName",
        material_group AS "materialGroup",
        customer_name AS "customerName",
        customer_subgroup AS "customerSubgroup",
        ship_to_party AS "shipToParty",
        ship_to_state AS "shipToState",
        ship_to_city AS "shipToCity",
        inventory_number AS "inventoryNumber",
        TO_CHAR(warr_start_dt, 'YYYY-MM-DD') AS "warrStartDt",
        TO_CHAR(warr_end_dt, 'YYYY-MM-DD') AS "warrEndDt",
        pin_code AS "pinCode",
        warranty_months AS "warrantyMonths",
        (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE) AS "isActive"
      FROM public.warranty_master_items
      WHERE ${whereSql}
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
        material AS "fgModel",
        machine_count AS "machineCount",
        active_machine_count AS "activeMachineCount",
        TO_CHAR(min_warr_end, 'YYYY-MM-DD') AS "minWarrEnd",
        TO_CHAR(max_warr_end, 'YYYY-MM-DD') AS "maxWarrEnd"
      FROM public.warranty_master_rollup
      ORDER BY subgroup_label, group_label, warranty_months, material
    `);
    return res.rows;
  });
}

const ROLLUP_CREATE_DDL = `
CREATE TABLE IF NOT EXISTS public.warranty_master_rollup (
  subgroup_key          text NOT NULL,
  subgroup_label        text NOT NULL,
  group_key             text NOT NULL,
  group_label           text NOT NULL,
  warranty_months       smallint NOT NULL,
  material              text NOT NULL,
  machine_count         integer NOT NULL,
  active_machine_count  integer NOT NULL,
  min_warr_end          date,
  max_warr_end          date,
  PRIMARY KEY (subgroup_key, group_key, warranty_months, material)
);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_subgroup ON public.warranty_master_rollup (subgroup_key);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_group ON public.warranty_master_rollup (group_key);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_material ON public.warranty_master_rollup (material);
CREATE INDEX IF NOT EXISTS idx_wm_rollup_months ON public.warranty_master_rollup (warranty_months);
`;

/** Drop leftover composite type if a prior CREATE raced/failed mid-flight. */
const ROLLUP_RECREATE_DDL = `
DROP TABLE IF EXISTS public.warranty_master_rollup CASCADE;
DROP TYPE IF EXISTS public.warranty_master_rollup CASCADE;
${ROLLUP_CREATE_DDL}
`;

type PgClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

let rollupSchemaOk = false;
/** Last successful items↔rollup count check (process-local). */
let rollupSyncCheckedAt = 0;
// ponytail: 5s TTL avoids COUNT(*) on every parallel mode= call; upgrade to NOTIFY/trigger if deletes must show instantly.
const ROLLUP_SYNC_CHECK_MS = 5_000;

async function rollupHasMaterialColumn(client: PgClient): Promise<boolean> {
  const col = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'warranty_master_rollup'
        AND column_name = 'material'
    ) AS exists
  `);
  return Boolean(col.rows[0]?.exists);
}

async function rollupMatchesItems(client: PgClient): Promise<boolean> {
  const res = await client.query<{ items: string; rollup: string }>(`
    SELECT
      (SELECT COUNT(*)::text FROM public.warranty_master_items) AS items,
      (SELECT COALESCE(SUM(machine_count), 0)::text FROM public.warranty_master_rollup) AS rollup
  `);
  return Number(res.rows[0]?.items ?? 0) === Number(res.rows[0]?.rollup ?? 0);
}

/**
 * Before any rollup read: schema ok + machine totals match items.
 * Catches manual DB deletes/imports that skipped refreshWarrantyMasterRollup.
 */
async function ensureWarrantyMasterRollup(client: PgClient): Promise<void> {
  if (rollupSchemaOk && Date.now() - rollupSyncCheckedAt < ROLLUP_SYNC_CHECK_MS) return;
  // Serialize concurrent page loads that all try to rebuild an empty/stale rollup.
  await client.query(`SELECT pg_advisory_lock(87201452)`);
  try {
    if (rollupSchemaOk && Date.now() - rollupSyncCheckedAt < ROLLUP_SYNC_CHECK_MS) return;
    if (!(await rollupHasMaterialColumn(client))) {
      await client.query(ROLLUP_RECREATE_DDL);
    } else {
      await client.query(ROLLUP_CREATE_DDL);
    }
    rollupSchemaOk = true;
    if (!(await rollupMatchesItems(client))) {
      await rebuildWarrantyMasterRollupRows(client);
    }
    rollupSyncCheckedAt = Date.now();
  } finally {
    await client.query(`SELECT pg_advisory_unlock(87201452)`);
  }
}

async function rebuildWarrantyMasterRollupRows(client: PgClient): Promise<void> {
  // Grain keys are case-folded so 'Amul'/'AMUL' and material casing variants collapse.
  // PK material stores the folded key (same as group_key) — avoids pkey clashes from MODE() casing.
  await client.query('BEGIN');
  try {
    await client.query(`TRUNCATE public.warranty_master_rollup`);
    await client.query(`
      INSERT INTO public.warranty_master_rollup (
        subgroup_key, subgroup_label, group_key, group_label,
        warranty_months, material, machine_count, active_machine_count,
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
        COALESCE(warranty_months, 0) AS warranty_months,
        LOWER(COALESCE(NULLIF(BTRIM(material), ''), '(Unknown)')) AS material,
        COUNT(*)::int AS machine_count,
        SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)::int
          AS active_machine_count,
        MIN(warr_end_dt) AS min_warr_end,
        MAX(warr_end_dt) AS max_warr_end
      FROM public.warranty_master_items
      GROUP BY
        LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
        LOWER(COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
        COALESCE(warranty_months, 0),
        LOWER(COALESCE(NULLIF(BTRIM(material), ''), '(Unknown)'))
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function refreshWarrantyMasterRollupWithClient(client: PgClient): Promise<void> {
  await client.query(`SELECT pg_advisory_lock(87201452)`);
  try {
    if (!(await rollupHasMaterialColumn(client))) {
      await client.query(ROLLUP_RECREATE_DDL);
    } else {
      await client.query(ROLLUP_CREATE_DDL);
    }
    await rebuildWarrantyMasterRollupRows(client);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(87201452)`);
  }
}

/** Rebuild rollup after Excel import (or empty table). One 5M scan, then reports are cheap. */
export async function refreshWarrantyMasterRollup(): Promise<void> {
  await withAppClient(async (client) => {
    await refreshWarrantyMasterRollupWithClient(client);
    rollupSchemaOk = true;
    rollupSyncCheckedAt = Date.now();
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
    const models = params.fgModel.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (models.length > 0) {
      conditions.push(`material = ANY($${idx})`);
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

/** KPI counts for the current filter window — rollup, or items when Sold-To filter is set. */
export async function queryWarrantyMasterSummaryFromDb(
  params: WarrantyMasterQueryParams
): Promise<WarrantyMasterSummaryResult> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    const catalogRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(machine_count), 0)::text AS total FROM public.warranty_master_rollup`
    );
    const catalogMachineTotal = Number(catalogRes.rows[0]?.total ?? 0);

    if (splitCsvParam(params.soldTo).length > 0) {
      const { sql: whereSql, values } = buildItemsFilterWhere(params);
      const res = await client.query<{
        total_machines: number;
        distinct_customers: number;
        distinct_groups: number;
        table_rows: number;
      }>(
        `
        SELECT
          COUNT(*)::int AS total_machines,
          COUNT(DISTINCT LOWER(BTRIM(customer_subgroup)))::int AS distinct_customers,
          COUNT(DISTINCT LOWER(BTRIM(group_name)))::int AS distinct_groups,
          COUNT(DISTINCT LOWER(BTRIM(customer_subgroup)))::int AS table_rows
        FROM public.warranty_master_items
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
    }

    const { sql: whereSql, values, countExpr } = buildRollupFilterWhere(params);
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

/** Filter dropdown values from rollup (tiny) + Sold-To parties from items. */
export async function queryWarrantyMasterOptionsFromDb(): Promise<WarrantyMasterDims> {
  return withAppClient(async (client) => {
    await ensureWarrantyMasterRollup(client);
    // Sequential: node-pg forbids concurrent queries on one client.
    const soldToParties = await client.query<{ val: string; label: string }>(`
      SELECT customer_name AS val, customer_name AS label
      FROM (
        SELECT DISTINCT NULLIF(BTRIM(customer_name), '') AS customer_name
        FROM public.warranty_master_items
      ) t
      WHERE customer_name IS NOT NULL
      ORDER BY 1
    `);
    const customers = await client.query<{ val: string; label: string }>(`
      SELECT subgroup_key AS val, MIN(subgroup_label) AS label
      FROM public.warranty_master_rollup
      GROUP BY subgroup_key
      ORDER BY 2
    `);
    const groups = await client.query<{ val: string; label: string }>(`
      SELECT group_key AS val, MIN(group_label) AS label
      FROM public.warranty_master_rollup
      GROUP BY group_key
      ORDER BY 2
    `);
    const fgModels = await client.query<{ val: string; label: string }>(`
      SELECT material AS val, MIN(material) AS label
      FROM public.warranty_master_rollup
      WHERE material <> ''
      GROUP BY material
      ORDER BY 1
    `);
    const months = await client.query<{ val: number }>(`
      SELECT DISTINCT warranty_months AS val
      FROM public.warranty_master_rollup
      ORDER BY 1
    `);

    return {
      soldToParties: soldToParties.rows.map((r) => ({ value: r.label, label: r.label })),
      customers: customers.rows.map((r) => ({ value: r.label, label: r.label })),
      groups: groups.rows.map((r) => ({ value: r.label, label: r.label })),
      fgModels: fgModels.rows.map((r) => ({ value: r.val, label: r.label })),
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

function nestHierarchyRows(detailRows: HierarchyFlatRow[]): WarrantyMasterHierarchySubgroup[] {
  const subgroupMap = new Map<string, WarrantyMasterHierarchySubgroup>();
  for (const row of detailRows) {
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

  const order = [...new Set(detailRows.map((r) => r.subgroupKey))];
  return order
    .map((key) => subgroupMap.get(key))
    .filter((r): r is WarrantyMasterHierarchySubgroup => Boolean(r))
    .map((subgroup) => ({
      ...subgroup,
      groups: subgroup.groups.map((g): WarrantyMasterHierarchyGroup => ({
        ...g,
        warranties: [...g.warranties].sort((a, b) => a.warrantyMonths - b.warrantyMonths),
      })),
    }));
}

/** One page of customer subgroups with nested groups → warranties — from rollup (or items when Sold-To is set). */
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

    if (splitCsvParam(params.soldTo).length > 0) {
      const { sql: whereSql, values } = buildItemsFilterWhere(params);
      const countExpr = params.activeOnly
        ? `SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)`
        : `COUNT(*)`;

      const countRes = await client.query<{ total: number }>(
        `
        SELECT COUNT(*)::int AS total FROM (
          SELECT LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')) AS subgroup_key
          FROM public.warranty_master_items
          WHERE ${whereSql}
          GROUP BY 1
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
        WITH filtered AS (
          SELECT *
          FROM public.warranty_master_items
          WHERE ${whereSql}
        ),
        page_subgroups AS (
          SELECT
            LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')) AS subgroup_key,
            MODE() WITHIN GROUP (
              ORDER BY COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')
            ) AS subgroup_label
          FROM filtered
          GROUP BY 1
          ORDER BY MIN(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')) ${sortDir}
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        )
        SELECT
          p.subgroup_key AS "subgroupKey",
          p.subgroup_label AS "subgroup",
          LOWER(COALESCE(NULLIF(BTRIM(f.group_name), ''), '(Unknown)')) AS "groupKey",
          MODE() WITHIN GROUP (
            ORDER BY COALESCE(NULLIF(BTRIM(f.group_name), ''), '(Unknown)')
          ) AS "groupName",
          COALESCE(f.warranty_months, 0) AS "warrantyMonths",
          ${countExpr}::int AS "machineCount",
          TO_CHAR(MIN(f.warr_end_dt), 'YYYY-MM-DD') AS "minWarrEnd",
          TO_CHAR(MAX(f.warr_end_dt), 'YYYY-MM-DD') AS "maxWarrEnd"
        FROM filtered f
        INNER JOIN page_subgroups p
          ON LOWER(COALESCE(NULLIF(BTRIM(f.customer_subgroup), ''), '(Unknown)')) = p.subgroup_key
        GROUP BY p.subgroup_key, p.subgroup_label,
          LOWER(COALESCE(NULLIF(BTRIM(f.group_name), ''), '(Unknown)')),
          COALESCE(f.warranty_months, 0)
        HAVING ${countExpr} > 0
        ORDER BY p.subgroup_label ${sortDir}, 4 ASC, 5 ASC
        `,
        [...values, pageSize, offset]
      );

      return { rows: nestHierarchyRows(detailRes.rows), total, page, pageSize };
    }

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

    return { rows: nestHierarchyRows(detailRes.rows), total, page, pageSize };
  });
}

