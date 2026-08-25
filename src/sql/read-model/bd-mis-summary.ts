import { prisma } from '@/lib/db/prisma';
import type { SummaryDashboard } from '@/lib/summary/derive';
import { normalizeCallTypeDisplay } from '@/lib/call/display/call-type';
import {
  ensureNormalizeCallTypeFunction,
  type SummaryQueryParams,
} from '@/sql/read-model/summary';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/sql/read-model/summary-call-filters';
import {
  HOT_OFFICE_JOINS_SQL,
  HOT_RESOLVED_REGION_SQL,
} from '@/sql/read-model/hot-region';
import { AGING_BUCKET_SQL, openCallsFromAging } from '@/lib/aging/buckets';

const BREAKDOWN = 'BREAKDOWN';

/** BD MIS Excel Main union: total_calls exclude cancelled; cancelled_calls counted separately. */
const BD_MIS_NON_CANCELLED = `h.status_bucket != 'cancelled'`;

/** Register export / live CRM zone (blank h.region → office zone). */
const BD_MIS_REGION_SQL = HOT_RESOLVED_REGION_SQL;

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function resolveAgingDate(params: SummaryQueryParams): string {
  if (params.agingAsOf) return params.agingAsOf;
  if (params.endDate) return params.endDate;
  return new Date().toISOString().slice(0, 10);
}

function buildOfficeFilter(
  params: SummaryQueryParams,
  alias: string,
  startIdx: number,
  officeColumn = 'nofficeid'
): {
  clause: string;
  values: unknown[];
  nextIdx: number;
} {
  const values: unknown[] = [];
  let idx = startIdx;
  const parts: string[] = [];

  if (!params.isHod && params.assignedOffices && params.assignedOffices.length > 0) {
    parts.push(`${alias}.${officeColumn} = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map((id) => Number(id)));
    idx++;
  }

  if (params.officeIds && params.officeIds.length > 0) {
    parts.push(`${alias}.${officeColumn} = ANY($${idx}::bigint[])`);
    values.push(params.officeIds.map((id) => Number(id)));
    idx++;
  }

  return {
    clause: parts.length ? ` AND ${parts.join(' AND ')}` : '',
    values,
    nextIdx: idx,
  };
}

function buildCallTypeFilter(
  params: SummaryQueryParams,
  alias: string,
  startIdx: number
): {
  clause: string;
  values: unknown[];
  nextIdx: number;
} {
  if (!params.callTypes || params.callTypes.length === 0) {
    return { clause: '', values: [], nextIdx: startIdx };
  }
  return {
    clause: ` AND upper(trim(${alias}.call_type)) = ANY($${startIdx}::text[])`,
    values: [params.callTypes.map((t) => normalizeCallTypeDisplay(t).toUpperCase())],
    nextIdx: startIdx + 1,
  };
}

/** CRM summary for BD MIS Excel parity (uses register Region column, not plant remap). */
export async function queryBdMisCrmSummary(params: SummaryQueryParams): Promise<SummaryDashboard> {
  await ensureNormalizeCallTypeFunction();

  const startDate = params.startDate || yearStart();
  const endDate = params.endDate || new Date().toISOString().slice(0, 10);
  const agingDate = resolveAgingDate(params);

  const periodStart = `${startDate}T00:00:00`;
  const periodEnd = `${endDate}T23:59:59`;

  const officeFilter = buildOfficeFilter(params, 'h', 3);
  const callTypeFilter = buildCallTypeFilter(params, 'h', officeFilter.nextIdx);
  const values = [periodStart, periodEnd, ...officeFilter.values, ...callTypeFilter.values];

  const branchRows = await prisma.$queryRawUnsafe<
    Array<{
      office_id: number;
      parent_id: number | null;
      branch: string | null;
      region: string;
      total_calls: number;
      solved_calls: number;
      cancelled_calls: number;
      open_calls: number;
      tech_solved_calls: number;
      deployment_total: number;
      deployment_done: number;
      installation_total: number;
      installation_done: number;
      headcount: number;
    }>
  >(
    `
    SELECT
      h.nofficeid AS office_id,
      d.nunder AS parent_id,
      COALESCE(d.vcompanyname, h.branch_name, 'UNKNOWN') AS branch,
      ${BD_MIS_REGION_SQL} AS region,
      count(*) FILTER (WHERE ${BD_MIS_NON_CANCELLED})::int AS total_calls,
      count(*) FILTER (WHERE h.status_bucket IN ('solved', 'tech_solved'))::int AS solved_calls,
      count(*) FILTER (WHERE h.status_bucket = 'cancelled')::int AS cancelled_calls,
      count(*) FILTER (WHERE h.status_bucket IN ('open_unallocated', 'assigned'))::int AS open_calls,
      count(*) FILTER (WHERE h.status_bucket = 'tech_solved')::int AS tech_solved_calls,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND ${BD_MIS_NON_CANCELLED}
      )::int AS deployment_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS deployment_done,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND ${BD_MIS_NON_CANCELLED}
      )::int AS installation_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS installation_done,
      COALESCE(MAX(h.branch_headcount), 0)::int AS headcount
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${officeFilter.clause}
      ${callTypeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY h.nofficeid, d.nunder, d.vcompanyname, h.branch_name, ${BD_MIS_REGION_SQL}
    ORDER BY branch ASC
    `,
    ...values
  );

  const agingOfficeFilter = buildOfficeFilter(params, 'h', 4);
  const agingCallTypeFilter = buildCallTypeFilter(params, 'h', agingOfficeFilter.nextIdx);
  const agingValues = [
    agingDate,
    periodStart,
    periodEnd,
    ...agingOfficeFilter.values,
    ...agingCallTypeFilter.values,
  ];

  const agingRows = await prisma.$queryRawUnsafe<
    Array<{
      office_id: number;
      age_2: number;
      age_3: number;
      age_7: number;
      age_15: number;
      part_pending: number;
      active_eng: number;
    }>
  >(
    `
    SELECT
      h.nofficeid AS office_id,
      ${AGING_BUCKET_SQL},
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    WHERE h.logged_at >= $2::timestamptz
      AND h.logged_at <= $3::timestamptz
      AND h.status_bucket IN ('open_unallocated', 'assigned')
      ${agingOfficeFilter.clause}
      ${agingCallTypeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY h.nofficeid
    `,
    ...agingValues
  );

  const agingByOffice = new Map(agingRows.map((row) => [Number(row.office_id), row]));

  const branchSummary = branchRows.map((row) => {
    const aging = agingByOffice.get(Number(row.office_id));
    const age_2 = aging?.age_2 ?? 0;
    const age_3 = aging?.age_3 ?? 0;
    const age_7 = aging?.age_7 ?? 0;
    const age_15 = aging?.age_15 ?? 0;
    const openFromAging = openCallsFromAging({ age_2, age_3, age_7, age_15 });
    return {
      officeId: Number(row.office_id),
      parentId: Number(row.parent_id ?? 0),
      branch: row.branch ?? 'UNKNOWN',
      region: String(row.region ?? 'OTHER').toUpperCase(),
      total_calls: row.total_calls,
      solved_calls: row.solved_calls,
      cancelled_calls: row.cancelled_calls,
      open_calls: openFromAging > 0 ? openFromAging : row.open_calls,
      age_2,
      age_3,
      age_7,
      age_15,
      part_pending: aging?.part_pending ?? 0,
      all_total: row.total_calls,
      all_solved: row.solved_calls,
      all_cancelled: row.cancelled_calls,
      all_open: openFromAging > 0 ? openFromAging : row.open_calls,
      all_age_2: age_2,
      all_age_3: age_3,
      all_age_7: age_7,
      all_age_15: age_15,
      all_part_pending: aging?.part_pending ?? 0,
      all_tech_solved: row.tech_solved_calls,
      tech_solved_calls: row.tech_solved_calls,
      deployment_total: row.deployment_total,
      deployment_done: row.deployment_done,
      installation_total: row.installation_total,
      installation_done: row.installation_done,
      active_eng: aging?.active_eng ?? 0,
      population: row.total_calls,
      headcount: row.headcount,
    };
  });

  const accountOfficeFilter = buildOfficeFilter(params, 'h', 4);
  const accountValues = [periodStart, periodEnd, BREAKDOWN, ...accountOfficeFilter.values];

  const accountRows = await prisma.$queryRawUnsafe<
    Array<{
      region: string;
      account: string;
      total_calls: number;
      total_solved: number;
      cancelled_calls: number;
      open_calls: number;
      total_tech_solved: number;
      deployment_total: number;
      deployment_done: number;
      installation_total: number;
      installation_done: number;
    }>
  >(
    `
    SELECT
      ${BD_MIS_REGION_SQL} AS region,
      h.account,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type($3)
          AND ${BD_MIS_NON_CANCELLED}
      )::int AS total_calls,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type($3)
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS total_solved,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type($3)
          AND h.status_bucket = 'cancelled'
      )::int AS cancelled_calls,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type($3)
          AND h.status_bucket IN ('open_unallocated', 'assigned')
      )::int AS open_calls,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type($3)
          AND h.status_bucket = 'tech_solved'
      )::int AS total_tech_solved,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND ${BD_MIS_NON_CANCELLED}
      )::int AS deployment_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('DEPLOYMENT')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS deployment_done,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND ${BD_MIS_NON_CANCELLED}
      )::int AS installation_total,
      count(*) FILTER (
        WHERE normalize_call_type(h.call_type) = normalize_call_type('INSTALLATION CALL')
          AND h.status_bucket IN ('solved', 'tech_solved')
      )::int AS installation_done
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${accountOfficeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${BD_MIS_REGION_SQL}, h.account
    ORDER BY h.account ASC
    `,
    ...accountValues
  );

  const accountAgingOfficeFilter = buildOfficeFilter(params, 'h', 5);
  const accountAgingValues = [
    agingDate,
    BREAKDOWN,
    periodStart,
    periodEnd,
    ...accountAgingOfficeFilter.values,
  ];

  const accountAgingRows = await prisma.$queryRawUnsafe<
    Array<{
      region: string;
      account: string;
      age_2: number;
      age_3: number;
      age_7: number;
      age_15: number;
      part_pending: number;
      active_eng: number;
    }>
  >(
    `
    SELECT
      ${BD_MIS_REGION_SQL} AS region,
      h.account,
      ${AGING_BUCKET_SQL},
      SUM(CASE WHEN h.is_part_pending THEN 1 ELSE 0 END)::int AS part_pending,
      COUNT(DISTINCT NULLIF(h.engineer_name, ''))::int AS active_eng
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $3::timestamptz
      AND h.logged_at <= $4::timestamptz
      AND h.status_bucket IN ('open_unallocated', 'assigned')
      AND normalize_call_type(h.call_type) = normalize_call_type($2)
      ${accountAgingOfficeFilter.clause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    GROUP BY ${BD_MIS_REGION_SQL}, h.account
    `,
    ...accountAgingValues
  );

  const agingByAccount = new Map(
    accountAgingRows.map((row) => [`${row.region}-${row.account}`, row])
  );

  const regionHeadcount = new Map<string, number>();
  for (const branch of branchSummary) {
    regionHeadcount.set(
      branch.region,
      (regionHeadcount.get(branch.region) ?? 0) + branch.headcount
    );
  }

  const accountSummary = accountRows.map((row) => {
    const key = `${row.region}-${row.account}`;
    const aging = agingByAccount.get(key);
    const age_2 = aging?.age_2 ?? 0;
    const age_3 = aging?.age_3 ?? 0;
    const age_7 = aging?.age_7 ?? 0;
    const age_15 = aging?.age_15 ?? 0;
    const openFromAging = openCallsFromAging({ age_2, age_3, age_7, age_15 });
    return {
      region: String(row.region ?? 'OTHER').toUpperCase(),
      account: row.account,
      population: row.total_calls,
      total_calls: row.total_calls,
      total_solved: row.total_solved,
      cancelled_calls: row.cancelled_calls,
      open_calls: openFromAging > 0 ? openFromAging : row.open_calls,
      age_2,
      age_3,
      age_7,
      age_15,
      part_pending: aging?.part_pending ?? 0,
      deployment_total: row.deployment_total,
      deployment_done: row.deployment_done,
      installation_total: row.installation_total,
      installation_done: row.installation_done,
      active_eng: aging?.active_eng ?? 0,
      headcount: regionHeadcount.get(String(row.region ?? 'OTHER').toUpperCase()) ?? 0,
      total_tech_solved: row.total_tech_solved,
    };
  });

  const globalHeadcount = branchSummary.reduce((sum, row) => sum + row.headcount, 0);

  return { branchSummary, accountSummary, globalHeadcount };
}

export type BdMisCrmCallTraceDbRow = {
  region: string;
  plant: string | null;
  technician_name: string | null;
  office_under_branch: string | null;
  customer_name: string | null;
  logged_at: Date;
  service_order: string;
  client: string;
  call_status: string | null;
  status_bucket: string;
  ncancelreason: number | null;
  account: string;
  wco: string | null;
  ncode: number;
  nofficeid: number;
};

/** Call-level CRM rows for BD MIS trace export (same filters as summary rollup). */
export async function queryBdMisCrmCallTraceRows(
  params: SummaryQueryParams
): Promise<BdMisCrmCallTraceDbRow[]> {
  await ensureNormalizeCallTypeFunction();

  const startDate = params.startDate || yearStart();
  const endDate = params.endDate || new Date().toISOString().slice(0, 10);
  const periodStart = `${startDate}T00:00:00`;
  const periodEnd = `${endDate}T23:59:59`;

  const officeFilter = buildOfficeFilter(params, 'h', 3);
  const callTypeFilter = buildCallTypeFilter(params, 'h', officeFilter.nextIdx);
  const values: unknown[] = [periodStart, periodEnd, ...officeFilter.values, ...callTypeFilter.values];
  let statusClause = '';
  if (params.statusBuckets?.length) {
    values.push(params.statusBuckets);
    statusClause = `AND h.status_bucket::text = ANY($${values.length}::text[])`;
  }

  const rows = await prisma.$queryRawUnsafe<BdMisCrmCallTraceDbRow[]>(
    `
    SELECT
      ${BD_MIS_REGION_SQL} AS region,
      COALESCE(
        NULLIF(trim(h.branch_name), ''),
        NULLIF(trim(d.vcompanyname), ''),
        NULLIF(trim(d_parent.vcompanyname), ''),
        NULLIF(trim(h.franchisee_name), ''),
        NULLIF(trim(h.party_name), '')
      ) AS plant,
      NULLIF(trim(h.engineer_name), '') AS technician_name,
      COALESCE(
        NULLIF(trim(h.franchisee_name), ''),
        NULLIF(trim(h.party_name), ''),
        NULLIF(trim(d_parent.vcompanyname), ''),
        NULLIF(trim(h.branch_name), ''),
        NULLIF(trim(d.vcompanyname), '')
      ) AS office_under_branch,
      NULLIF(trim(h.party_name), '') AS customer_name,
      h.logged_at,
      h.vtrnno AS service_order,
      h.account AS client,
      h.status_label AS call_status,
      h.status_bucket::text AS status_bucket,
      h.ncancelreason,
      h.account,
      h.wco,
      h.ncode,
      h.nofficeid
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    LEFT JOIN dim_offices d_parent ON d_parent.ncode = NULLIF(d.nunder, 0)
    ${HOT_OFFICE_JOINS_SQL}
    WHERE h.logged_at >= $1::timestamptz
      AND h.logged_at <= $2::timestamptz
      ${officeFilter.clause}
      ${callTypeFilter.clause}
      ${statusClause}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    ORDER BY ${BD_MIS_REGION_SQL}, h.logged_at, h.vtrnno
    `,
    ...values
  );

  return rows;
}
