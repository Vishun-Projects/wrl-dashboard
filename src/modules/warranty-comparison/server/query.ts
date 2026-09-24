import 'server-only';

import { formatUiDateDash } from '@/lib/dates/ui-date';
import { withAppClient } from '@/lib/read-model/db';
import type {
  WarrantyComparisonFilterOptions,
  WarrantyComparisonFilterParams,
  WarrantyComparisonRow,
  WarrantyComparisonRowsResponse,
  WarrantyComparisonSummary,
} from '../types';

/** End − start in calendar months. Same day → 0. Missing dates → NULL. */
const WARRANTY_MONTHS_SQL = `CASE
  WHEN w.warr_start_dt IS NULL OR w.warr_end_dt IS NULL THEN NULL
  ELSE GREATEST(0, (
    EXTRACT(YEAR FROM age(w.warr_end_dt, w.warr_start_dt)) * 12
    + EXTRACT(MONTH FROM age(w.warr_end_dt, w.warr_start_dt))
  )::int)
END`;

export type UserScope = {
  isHod?: boolean;
  assignedOffices?: (string | number)[];
};

export function parseWarrantyComparisonFilters(
  searchParams: URLSearchParams
): WarrantyComparisonFilterParams {
  const tabParam = searchParams.get('tab') ?? 'oow_in_warr';
  const tab =
    tabParam === 'in_warr_oow' || tabParam === 'all' ? tabParam : 'oow_in_warr';

  const parseArray = (paramName: string) => {
    const raw = searchParams.get(paramName);
    if (!raw) return undefined;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  };

  return {
    tab,
    startDate: searchParams.get('startDate') ?? undefined,
    endDate: searchParams.get('endDate') ?? undefined,
    search: searchParams.get('search')?.trim() || undefined,
    branches: parseArray('branches'),
    accounts: parseArray('accounts'),
    callTypes: parseArray('callTypes'),
    statuses: parseArray('statuses'),
    page: Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1),
    pageSize: Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize') ?? '25', 10) || 25)),
    sortBy: (searchParams.get('sortBy') as WarrantyComparisonFilterParams['sortBy']) ?? 'callDate',
    sortDir: searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc',
  };
}

/**
 * Builds the shared WHERE clause for matching calls in calls_latest_hot
 */
function buildCallsWhereClause(
  filters: WarrantyComparisonFilterParams & UserScope,
  values: unknown[],
  startIdx = 1
): { whereSql: string; nextIdx: number } {
  const conditions: string[] = ["NULLIF(TRIM(c.serial), '') IS NOT NULL"];
  let idx = startIdx;

  if (filters.startDate) {
    conditions.push(`c.logged_at >= $${idx}::date`);
    values.push(filters.startDate);
    idx++;
  }

  if (filters.endDate) {
    conditions.push(`c.logged_at < ($${idx}::date + interval '1 day')`);
    values.push(filters.endDate);
    idx++;
  }

  if (!filters.isHod && filters.assignedOffices && filters.assignedOffices.length > 0) {
    const offices = filters.assignedOffices.map(Number).filter((n) => Number.isFinite(n));
    if (offices.length > 0) {
      conditions.push(`c.nofficeid = ANY($${idx}::int[])`);
      values.push(offices);
      idx++;
    }
  }

  if (filters.branches && filters.branches.length > 0) {
    conditions.push(`c.branch_name = ANY($${idx}::text[])`);
    values.push(filters.branches);
    idx++;
  }

  if (filters.accounts && filters.accounts.length > 0) {
    conditions.push(`c.account = ANY($${idx}::text[])`);
    values.push(filters.accounts);
    idx++;
  }

  if (filters.callTypes && filters.callTypes.length > 0) {
    conditions.push(`UPPER(TRIM(c.call_type)) = ANY($${idx}::text[])`);
    values.push(filters.callTypes.map((t) => t.trim().toUpperCase()));
    idx++;
  }

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(`c.status_label = ANY($${idx}::text[])`);
    values.push(filters.statuses);
    idx++;
  }

  if (filters.search) {
    const s = `%${filters.search}%`;
    conditions.push(`(
      c.serial ILIKE $${idx}
      OR c.vtrnno ILIKE $${idx}
      OR c.party_name ILIKE $${idx}
      OR c.item_name ILIKE $${idx}
    )`);
    values.push(s);
    idx++;
  }

  return {
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    nextIdx: idx,
  };
}

/**
 * Fetch summary KPI metrics for the current date window and scope
 */
export async function fetchWarrantyComparisonSummary(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonSummary> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    const { whereSql } = buildCallsWhereClause(filters, values);

    const sql = `
      WITH base_calls AS (
        SELECT
          c.serial,
          c.logged_at,
          c.wco,
          c.vtrnno
        FROM public.calls_latest_hot c
        ${whereSql}
      ),
      joined AS (
        SELECT
          bc.vtrnno,
          bc.serial,
          bc.logged_at,
          bc.wco,
          w.warr_start_dt,
          w.warr_end_dt,
          (w.serial_no IS NOT NULL) AS has_master
        FROM base_calls bc
        LEFT JOIN public.warranty_master_items w
          ON UPPER(w.serial_no) = UPPER(bc.serial)
      )
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(CASE WHEN has_master AND warr_end_dt IS NOT NULL THEN 1 END)::int AS total_with_master,
        COUNT(CASE
          WHEN has_master
            AND warr_end_dt IS NOT NULL
            AND CAST(logged_at AS DATE) > CAST(warr_end_dt AS DATE)
            AND UPPER(TRIM(COALESCE(wco, ''))) = 'W'
          THEN 1
        END)::int AS oow_in_warr_count,
        COUNT(CASE
          WHEN has_master
            AND warr_end_dt IS NOT NULL
            AND CAST(logged_at AS DATE) <= CAST(warr_end_dt AS DATE)
            AND (warr_start_dt IS NULL OR CAST(logged_at AS DATE) >= CAST(warr_start_dt AS DATE))
            AND UPPER(TRIM(COALESCE(wco, ''))) = 'O'
          THEN 1
        END)::int AS in_warr_oow_count,
        COUNT(DISTINCT CASE
          WHEN has_master
            AND warr_end_dt IS NOT NULL
            AND (
              (CAST(logged_at AS DATE) > CAST(warr_end_dt AS DATE) AND UPPER(TRIM(COALESCE(wco, ''))) = 'W')
              OR
              (CAST(logged_at AS DATE) <= CAST(warr_end_dt AS DATE)
               AND (warr_start_dt IS NULL OR CAST(logged_at AS DATE) >= CAST(warr_start_dt AS DATE))
               AND UPPER(TRIM(COALESCE(wco, ''))) = 'O')
            )
          THEN UPPER(TRIM(serial))
        END)::int AS unique_serials_count
      FROM joined
    `;

    const res = await client.query(sql, values);
    const row = res.rows[0] ?? {};

    return {
      totalCallsAnalyzed: row.total_calls ?? 0,
      totalWithWarrantyMaster: row.total_with_master ?? 0,
      oowInWarrCount: row.oow_in_warr_count ?? 0,
      inWarrOowCount: row.in_warr_oow_count ?? 0,
      uniqueSerialsCount: row.unique_serials_count ?? 0,
    };
  });
}

/**
 * Fetch paginated mismatch rows
 */
export async function fetchWarrantyComparisonRows(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonRowsResponse> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    const { whereSql, nextIdx } = buildCallsWhereClause(filters, values);

    let tabCondition = '';
    if (filters.tab === 'oow_in_warr') {
      tabCondition = `
        AND w.warr_end_dt IS NOT NULL
        AND CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE)
        AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'W'
      `;
    } else if (filters.tab === 'in_warr_oow') {
      tabCondition = `
        AND w.warr_end_dt IS NOT NULL
        AND CAST(c.logged_at AS DATE) <= CAST(w.warr_end_dt AS DATE)
        AND (w.warr_start_dt IS NULL OR CAST(c.logged_at AS DATE) >= CAST(w.warr_start_dt AS DATE))
        AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'O'
      `;
    } else {
      tabCondition = `
        AND w.warr_end_dt IS NOT NULL
        AND (
          (CAST(c.logged_at AS DATE) > CAST(warr_end_dt AS DATE) AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'W')
          OR
          (CAST(c.logged_at AS DATE) <= CAST(warr_end_dt AS DATE)
           AND (w.warr_start_dt IS NULL OR CAST(c.logged_at AS DATE) >= CAST(w.warr_start_dt AS DATE))
           AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'O')
        )
      `;
    }

    // Count matching rows
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM public.calls_latest_hot c
      JOIN public.warranty_master_items w
        ON UPPER(w.serial_no) = UPPER(c.serial)
      ${whereSql}
      ${tabCondition}
    `;

    const countRes = await client.query<{ total: number }>(countSql, values);
    const total = countRes.rows[0]?.total ?? 0;

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

    // Sorting map
    const sortFieldMap: Record<string, string> = {
      callDate: 'c.logged_at',
      vtrnno: 'c.vtrnno',
      serial: 'c.serial',
      partyName: 'c.party_name',
      account: 'c.account',
      customerSubgroup: 'w.customer_subgroup',
      billingDoc: 'w.billing_doc',
      warrEndDt: 'w.warr_end_dt',
      warrantyMonths: WARRANTY_MONTHS_SQL,
      daysDelta: 'ABS(CAST(c.logged_at AS DATE) - CAST(w.warr_end_dt AS DATE))',
    };
    const sortCol = sortFieldMap[filters.sortBy ?? 'callDate'] ?? 'c.logged_at';
    const sortDirection = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

    const dataSql = `
      SELECT
        c.vtrnno,
        c.vcclid,
        TO_CHAR(c.logged_at, 'YYYY-MM-DD') AS "callDate",
        COALESCE(c.call_type, '') AS "callType",
        COALESCE(c.status_label, '') AS "status",
        COALESCE(c.serial, '') AS "serial",
        COALESCE(c.wco, '') AS "callWco",
        COALESCE(c.party_name, '') AS "partyName",
        COALESCE(c.branch_name, '') AS "branchName",
        COALESCE(c.region, '') AS "region",
        COALESCE(c.account, '') AS "account",
        COALESCE(c.item_name, '') AS "itemName",
        COALESCE(w.customer_name, '') AS "customerName",
        w.customer_subgroup AS "customerSubgroup",
        COALESCE(w.group_name, '') AS "groupName",
        COALESCE(w.fg_model, '') AS "fgModel",
        ${WARRANTY_MONTHS_SQL} AS "warrantyMonths",
        TO_CHAR(w.warr_start_dt, 'YYYY-MM-DD') AS "warrStartDt",
        TO_CHAR(w.warr_end_dt, 'YYYY-MM-DD') AS "warrEndDt",
        w.billing_doc AS "billingDoc",
        TO_CHAR(w.billing_date, 'YYYY-MM-DD') AS "billingDate",
        CASE
          WHEN CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE) THEN 'EXPIRED'
          ELSE 'ACTIVE'
        END AS "masterWarrantyStatus",
        CASE
          WHEN CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE) THEN 'oow_in_warr'
          ELSE 'in_warr_oow'
        END AS "mismatchType",
        (CAST(c.logged_at AS DATE) - CAST(w.warr_end_dt AS DATE))::int AS "daysDelta"
      FROM public.calls_latest_hot c
      JOIN public.warranty_master_items w
        ON UPPER(w.serial_no) = UPPER(c.serial)
      ${whereSql}
      ${tabCondition}
      ORDER BY ${sortCol} ${sortDirection}, c.vtrnno DESC
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
    `;

    const dataRes = await client.query<WarrantyComparisonRow>(dataSql, [
      ...values,
      pageSize,
      offset,
    ]);

    return {
      rows: dataRes.rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });
}

/**
 * Filter options for dropdowns (branch, account, call types)
 */
export async function fetchWarrantyComparisonOptions(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonFilterOptions> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    // Only filter options by date and user branch scope so dropdown options don't vanish when one is selected
    const scopeFilters: WarrantyComparisonFilterParams & UserScope = {
      tab: filters.tab,
      startDate: filters.startDate,
      endDate: filters.endDate,
      isHod: filters.isHod,
      assignedOffices: filters.assignedOffices,
    };
    const { whereSql } = buildCallsWhereClause(scopeFilters, values);

    const sql = `
      SELECT DISTINCT ON (col, val) col, val FROM (
        SELECT 'branch'   AS col, c.branch_name   AS val FROM public.calls_latest_hot c ${whereSql}
        UNION ALL
        SELECT 'account'  AS col, c.account       AS val FROM public.calls_latest_hot c ${whereSql}
        UNION ALL
        SELECT 'callType' AS col, c.call_type     AS val FROM public.calls_latest_hot c ${whereSql}
        UNION ALL
        SELECT 'status'   AS col, c.status_label  AS val FROM public.calls_latest_hot c ${whereSql}
      ) t
      WHERE val IS NOT NULL AND TRIM(val) <> ''
    `;

    const res = await client.query<{ col: string; val: string }>(sql, values);

    const branchSet = new Set<string>();
    const accountSet = new Set<string>();
    const callTypeSet = new Set<string>();
    const statusSet = new Set<string>();

    for (const r of res.rows) {
      const v = r.val.trim();
      if (r.col === 'branch')   branchSet.add(v);
      if (r.col === 'account')  accountSet.add(v);
      if (r.col === 'callType') callTypeSet.add(v);
      if (r.col === 'status')   statusSet.add(v);
    }

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const toSortedOptions = (set: Set<string>) =>
      [...set]
        .sort((a, b) => collator.compare(a, b))
        .map((s) => ({ value: s, label: s }));

    return {
      branches: toSortedOptions(branchSet),
      accounts: toSortedOptions(accountSet),
      callTypes: toSortedOptions(callTypeSet),
      statuses: toSortedOptions(statusSet),
    };
  });
}

/**
 * Export matching mismatch rows to CSV
 */
export async function buildWarrantyComparisonCsvStream(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<Response> {
  const result = await fetchWarrantyComparisonRows({
    ...filters,
    page: 1,
    pageSize: 10000,
  });

  const headers = [
    'Call No',
    'Call Date',
    'Machine Serial',
    'Party Name',
    'Branch',
    'Region',
    'Account as per CRM',
    'Account as per System',
    'Invoice Number',
    'Item / Model Name',
    'Master Warranty End Date',
    'Warranty Months',
    'Warranty as per Call (WCO)',
    'Master Status on Call Date',
    'Mismatch Category',
    'Days Delta to Expiry',
    'Call Type',
    'Status',
    'Master Customer',
    'Customer Subgroup',
    'Master Group',
    'Master FG Model',
    'Warranty Start Date',
    'Billing Date',
  ];

  const escapeCsv = (val: unknown) => {
    if (val === null || val === undefined) return '';
    const str = String(val).replace(/"/g, '""');
    return /[",\n\r]/.test(str) ? `"${str}"` : str;
  };

  const csvRows = [headers.join(',')];

  for (const r of result.rows) {
    const mismatchLabel =
      r.mismatchType === 'oow_in_warr'
        ? 'Machine OOW but Call In-Warranty'
        : 'Machine In-Warranty but Call OOW';

    const deltaLabel =
      r.daysDelta > 0
        ? `Expired ${r.daysDelta} days before call`
        : `Active (${Math.abs(r.daysDelta)} days remaining)`;

    csvRows.push(
      [
        escapeCsv(r.vtrnno),
        escapeCsv(formatUiDateDash(r.callDate)),
        escapeCsv(r.serial),
        escapeCsv(r.partyName),
        escapeCsv(r.branchName),
        escapeCsv(r.region),
        escapeCsv(r.account),
        escapeCsv(r.customerSubgroup),
        escapeCsv(r.billingDoc),
        escapeCsv(r.itemName),
        escapeCsv(formatUiDateDash(r.warrEndDt)),
        escapeCsv(r.warrantyMonths),
        escapeCsv(r.callWco),
        escapeCsv(r.masterWarrantyStatus),
        escapeCsv(mismatchLabel),
        escapeCsv(deltaLabel),
        escapeCsv(r.callType),
        escapeCsv(r.status),
        escapeCsv(r.customerName),
        escapeCsv(r.customerSubgroup),
        escapeCsv(r.groupName),
        escapeCsv(r.fgModel),
        escapeCsv(formatUiDateDash(r.warrStartDt)),
        escapeCsv(formatUiDateDash(r.billingDate)),
      ].join(',')
    );
  }

  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const filename = `warranty_comparison_${filters.tab}_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
