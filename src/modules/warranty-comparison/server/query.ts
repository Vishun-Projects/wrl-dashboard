import 'server-only';

import { formatUiDateDash } from '@/lib/dates/ui-date';
import { withAppClient } from '@/lib/read-model/db';
import { foldAccountName } from '../account-label';
import { resolveCoveredVtrnnos } from './exceptions';
import { amcCoverSql } from '../exception-cover';
import { WARRANTY_MONTHS_SQL } from './serial-strip';
import type {
  WarrantyComparisonFilterOptions,
  WarrantyComparisonFilterParams,
  WarrantyComparisonRow,
  WarrantyComparisonRowsResponse,
  WarrantyComparisonSummary,
} from '../types';

export type UserScope = {
  isHod?: boolean;
  assignedOffices?: (string | number)[];
};

export function parseWarrantyComparisonFilters(
  searchParams: URLSearchParams
): WarrantyComparisonFilterParams {
  const tabParam = searchParams.get('tab') ?? 'oow_in_warr';
  const tab =
    tabParam === 'in_warr_oow' || tabParam === 'all' || tabParam === 'exception_ok'
      ? tabParam
      : 'oow_in_warr';

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
    systemAccounts: parseArray('systemAccounts'),
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
    conditions.push(`UPPER(TRIM(c.account)) = ANY($${idx}::text[])`);
    values.push(filters.accounts.map((a) => a.trim().toUpperCase()));
    idx++;
  }

  if (filters.systemAccounts && filters.systemAccounts.length > 0) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.warranty_master_items w
      WHERE UPPER(w.serial_no) = UPPER(c.serial)
        AND UPPER(TRIM(w.customer_subgroup)) = ANY($${idx}::text[])
    )`);
    values.push(filters.systemAccounts.map((a) => a.trim().toUpperCase()));
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

function buildTabCondition(tab: WarrantyComparisonFilterParams['tab']): string {
  if (tab === 'oow_in_warr' || tab === 'exception_ok') {
    return `
        AND w.warr_end_dt IS NOT NULL
        AND CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE)
        AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'W'
      `;
  }
  if (tab === 'in_warr_oow') {
    return `
        AND w.warr_end_dt IS NOT NULL
        AND CAST(c.logged_at AS DATE) <= CAST(w.warr_end_dt AS DATE)
        AND (w.warr_start_dt IS NULL OR CAST(c.logged_at AS DATE) >= CAST(w.warr_start_dt AS DATE))
        AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'O'
      `;
  }
  return `
        AND w.warr_end_dt IS NOT NULL
        AND (
          (CAST(c.logged_at AS DATE) > CAST(w.warr_end_dt AS DATE) AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'W')
          OR
          (CAST(c.logged_at AS DATE) <= CAST(w.warr_end_dt AS DATE)
           AND (w.warr_start_dt IS NULL OR CAST(c.logged_at AS DATE) >= CAST(w.warr_start_dt AS DATE))
           AND UPPER(TRIM(COALESCE(c.wco, ''))) = 'O')
        )
      `;
}

function tabAmcSql(tab: WarrantyComparisonFilterParams['tab']): string {
  if (tab === 'in_warr_oow') return '';
  if (tab === 'exception_ok') return amcCoverSql(false);
  // oow_in_warr + all: exclude AMC-covered from mismatch lists
  return amcCoverSql(true);
}

/**
 * Fetch summary KPI metrics for the current date window and scope.
 * Exception OK uses AMC cover only (no CRM compressor round-trips).
 */
export async function fetchWarrantyComparisonSummary(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonSummary> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    const { whereSql } = buildCallsWhereClause(filters, values);

    const sql = `
      WITH base_calls AS MATERIALIZED (
        SELECT
          c.serial,
          UPPER(TRIM(c.serial)) AS serial_u,
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
          w.customer_subgroup,
          (w.serial_no IS NOT NULL) AS has_master
        FROM base_calls bc
        LEFT JOIN public.warranty_master_items w
          ON UPPER(w.serial_no) = bc.serial_u
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
        END)::int AS unique_serials_count,
        COUNT(CASE
          WHEN has_master
            AND warr_end_dt IS NOT NULL
            AND CAST(logged_at AS DATE) > CAST(warr_end_dt AS DATE)
            AND UPPER(TRIM(COALESCE(wco, ''))) = 'W'
            AND EXISTS (
              SELECT 1 FROM public.warranty_exception_accounts e
              WHERE e.enabled
                AND e.amc AND e.amc_valid_upto IS NOT NULL
                AND UPPER(TRIM(e.system_account)) = UPPER(TRIM(customer_subgroup))
                AND CAST(logged_at AS DATE) <= e.amc_valid_upto
            )
          THEN 1
        END)::int AS exception_ok_count
      FROM joined
    `;

    const res = await client.query(sql, values);
    const row = res.rows[0] ?? {};
    const rawOow = Number(row.oow_in_warr_count ?? 0);
    const exceptionOkCount = Number(row.exception_ok_count ?? 0);
    const oowInWarrCount = Math.max(0, rawOow - exceptionOkCount);

    return {
      totalCallsAnalyzed: Number(row.total_calls ?? 0),
      totalWithWarrantyMaster: Number(row.total_with_master ?? 0),
      oowInWarrCount,
      inWarrOowCount: Number(row.in_warr_oow_count ?? 0),
      exceptionOkCount,
      uniqueSerialsCount: Number(row.unique_serials_count ?? 0),
    };
  });
}

/**
 * Fetch paginated mismatch rows — LIMIT first, exception cover only for the page.
 */
export async function fetchWarrantyComparisonRows(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonRowsResponse> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    const { whereSql, nextIdx } = buildCallsWhereClause(filters, values);
    const tabCondition = buildTabCondition(filters.tab);
    const amcSql = tabAmcSql(filters.tab);

    const fromSql = `
      FROM public.calls_latest_hot c
      JOIN public.warranty_master_items w
        ON UPPER(w.serial_no) = UPPER(TRIM(c.serial))
      ${whereSql}
      ${tabCondition}
      ${amcSql}
    `;

    const countRes = await client.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total ${fromSql}`,
      values
    );
    const total = countRes.rows[0]?.total ?? 0;

    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 25;
    const offset = (page - 1) * pageSize;

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
      ${fromSql}
      ORDER BY ${sortCol} ${sortDirection}, c.vtrnno DESC
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
    `;

    const dataRes = await client.query<WarrantyComparisonRow>(dataSql, [
      ...values,
      pageSize,
      offset,
    ]);

    const pageVtrnnos = dataRes.rows.map((r) => r.vtrnno).filter(Boolean);
    const covered = await resolveCoveredVtrnnos(client, whereSql, values, {
      vtrnnos: pageVtrnnos,
    });

    const rows = dataRes.rows.map((row) => ({
      ...row,
      exceptionReason: covered.get(row.vtrnno) ?? null,
    }));

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  });
}

/**
 * Filter options from filtered calls (no full mismatch join).
 */
export async function fetchWarrantyComparisonOptions(
  filters: WarrantyComparisonFilterParams & UserScope
): Promise<WarrantyComparisonFilterOptions> {
  return withAppClient(async (client) => {
    const shared: WarrantyComparisonFilterParams & UserScope = {
      tab: filters.tab,
      startDate: filters.startDate,
      endDate: filters.endDate,
      search: filters.search,
      isHod: filters.isHod,
      assignedOffices: filters.assignedOffices,
      callTypes: filters.callTypes,
    };

    const callValues: unknown[] = [];
    const { whereSql: callWhere } = buildCallsWhereClause(
      {
        ...shared,
        accounts: filters.accounts,
        systemAccounts: filters.systemAccounts,
        branches: filters.branches,
        statuses: filters.statuses,
      },
      callValues
    );

    const callOptsSql = `
      SELECT DISTINCT col, val FROM (
        SELECT 'branch' AS col, c.branch_name AS val
        FROM public.calls_latest_hot c
        ${callWhere}
        UNION ALL
        SELECT 'account', c.account
        FROM public.calls_latest_hot c
        ${callWhere}
        UNION ALL
        SELECT 'callType', c.call_type
        FROM public.calls_latest_hot c
        ${callWhere}
        UNION ALL
        SELECT 'status', c.status_label
        FROM public.calls_latest_hot c
        ${callWhere}
      ) t
      WHERE val IS NOT NULL AND TRIM(val) <> ''
    `;

    const sysValues: unknown[] = [];
    const { whereSql: sysWhere } = buildCallsWhereClause(shared, sysValues);
    const sysSql = `
      SELECT DISTINCT w.customer_subgroup AS val
      FROM public.calls_latest_hot c
      JOIN public.warranty_master_items w
        ON UPPER(w.serial_no) = UPPER(TRIM(c.serial))
      ${sysWhere}
      ${sysWhere ? 'AND' : 'WHERE'} w.customer_subgroup IS NOT NULL AND TRIM(w.customer_subgroup) <> ''
    `;

    const [callRows, sysRows] = await Promise.all([
      client.query<{ col: string; val: string }>(callOptsSql, callValues),
      client.query<{ val: string }>(sysSql, sysValues),
    ]);

    const branchSet = new Set<string>();
    const accountMap = new Map<string, string>();
    const systemAccountMap = new Map<string, string>();
    const callTypeSet = new Set<string>();
    const statusSet = new Set<string>();

    for (const r of callRows.rows) {
      const v = r.val.trim();
      if (r.col === 'branch') branchSet.add(v);
      if (r.col === 'account') foldAccountName(accountMap, v);
      if (r.col === 'callType') callTypeSet.add(v);
      if (r.col === 'status') statusSet.add(v);
    }
    for (const r of sysRows.rows) {
      foldAccountName(systemAccountMap, r.val.trim());
    }

    for (const t of filters.callTypes ?? []) {
      if (t.trim()) callTypeSet.add(t.trim());
    }

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const toSortedOptions = (set: Set<string>) =>
      [...set]
        .sort((a, b) => collator.compare(a, b))
        .map((s) => ({ value: s, label: s }));

    return {
      branches: toSortedOptions(branchSet),
      accounts: toSortedOptions(new Set(accountMap.values())),
      systemAccounts: toSortedOptions(new Set(systemAccountMap.values())),
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
    'Exception Cover',
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
        escapeCsv(r.exceptionReason),
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
