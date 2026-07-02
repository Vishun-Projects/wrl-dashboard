import { prisma } from '@/lib/db/prisma';
import { normalizeCallTypeDisplay } from '@/lib/report/filters';
import {
  HOT_MAIN_BRANCH_OFFICE_ID_SQL,
  HOT_OFFICE_JOINS_SQL,
  HOT_RESOLVED_REGION_SQL,
} from '@/lib/read-model/queries/hot-region';
import { SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';

export type DrilldownQueryParams = {
  type: string;
  startDate?: string | null;
  endDate?: string | null;
  agingAsOf?: string | null;
  officeId?: string | null;
  region?: string | null;
  account?: string | null;
  callType?: string | null;
  assignedOffices?: string[];
  isHod?: boolean;
};

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function resolveAgingDate(params: DrilldownQueryParams): string {
  if (params.agingAsOf) return params.agingAsOf;
  if (params.endDate) return params.endDate;
  return new Date().toISOString().slice(0, 10);
}

function normalizeRegionFilter(region: string): string {
  const trimmed = region.trim().toUpperCase();
  if (trimmed.endsWith(' ZONE')) return trimmed;
  if (trimmed.endsWith(' REGION')) return trimmed.replace(/\s+REGION$/, ' ZONE');
  return `${trimmed} ZONE`;
}

function buildMetricFilter(type: string, agingDate: string, paramIdx: number): {
  clause: string;
  values: unknown[];
  nextIdx: number;
} {
  switch (type) {
    case 'solved_calls':
    case 'total_solved':
      return {
        clause: ` AND h.status_bucket IN ('solved', 'tech_solved')`,
        values: [],
        nextIdx: paramIdx,
      };
    case 'cancelled_calls':
      return {
        clause: ` AND h.status_bucket = 'cancelled'`,
        values: [],
        nextIdx: paramIdx,
      };
    case 'open_calls':
      return {
        clause: ` AND h.status_bucket IN ('open_unallocated', 'assigned')`,
        values: [],
        nextIdx: paramIdx,
      };
    case 'age_2':
      return {
        clause: ` AND h.status_bucket IN ('open_unallocated', 'assigned') AND ($${paramIdx}::date - h.logged_at::date) <= 2`,
        values: [agingDate],
        nextIdx: paramIdx + 1,
      };
    case 'age_3':
      return {
        clause: ` AND h.status_bucket IN ('open_unallocated', 'assigned') AND ($${paramIdx}::date - h.logged_at::date) BETWEEN 3 AND 7`,
        values: [agingDate],
        nextIdx: paramIdx + 1,
      };
    case 'age_7':
      return {
        clause: ` AND h.status_bucket IN ('open_unallocated', 'assigned') AND ($${paramIdx}::date - h.logged_at::date) BETWEEN 8 AND 15`,
        values: [agingDate],
        nextIdx: paramIdx + 1,
      };
    case 'age_15':
      return {
        clause: ` AND h.status_bucket IN ('open_unallocated', 'assigned') AND ($${paramIdx}::date - h.logged_at::date) > 15`,
        values: [agingDate],
        nextIdx: paramIdx + 1,
      };
    case 'part_pending':
      return {
        clause: ` AND h.is_part_pending = true`,
        values: [],
        nextIdx: paramIdx,
      };
    case 'total_calls':
    default:
      return { clause: '', values: [], nextIdx: paramIdx };
  }
}

export async function querySummaryDrilldown(
  params: DrilldownQueryParams
): Promise<Record<string, string>[]> {
  const startDate = params.startDate || yearStart();
  const endDate = params.endDate || new Date().toISOString().slice(0, 10);
  const agingDate = resolveAgingDate(params);

  const values: unknown[] = [`${startDate}T00:00:00`, `${endDate}T23:59:59`];
  let idx = 3;
  const clauses: string[] = [
    `h.logged_at >= $1::timestamptz`,
    `h.logged_at <= $2::timestamptz`,
    `NULLIF(trim(h.vtrnno), '') IS NOT NULL`,
    `COALESCE(h.ncancelreason, 0) <> 2`,
  ];

  if (!params.isHod && params.assignedOffices && params.assignedOffices.length > 0) {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map((id) => Number(id)));
    idx++;
  }

  if (params.officeId && params.officeId !== 'All') {
    clauses.push(`${HOT_MAIN_BRANCH_OFFICE_ID_SQL} = $${idx}::bigint`);
    values.push(Number(params.officeId));
    idx++;
  } else if (params.region && params.region !== 'AI' && params.region !== 'All') {
    clauses.push(`upper(trim(${HOT_RESOLVED_REGION_SQL})) = $${idx}`);
    values.push(normalizeRegionFilter(params.region));
    idx++;
  }

  if (params.account && params.account !== 'All India' && params.account !== 'All') {
    const accounts = params.account
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (accounts.length > 0) {
      clauses.push(`h.account = ANY($${idx}::text[])`);
      values.push(accounts);
      idx++;
    }
  }

  if (params.callType && params.callType !== 'All' && params.callType !== '') {
    const types = params.callType
      .split(',')
      .map((t) => normalizeCallTypeDisplay(t).toUpperCase())
      .filter(Boolean);
    if (types.length > 0) {
      clauses.push(`upper(trim(h.call_type)) = ANY($${idx}::text[])`);
      values.push(types);
      idx++;
    }
  }

  const metric = buildMetricFilter(params.type, agingDate, idx);
  clauses.push(metric.clause.replace(/^\s*AND\s*/, ''));
  values.push(...metric.values);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      ref_no: string | null;
      date_label: string | null;
      customer_name: string | null;
      product: string | null;
      serial: string | null;
      engineer: string | null;
      complaint: string | null;
      status: string | null;
    }>
  >(
    `
    SELECT
      COALESCE(NULLIF(trim(h.vtrnno), ''), '—') AS ref_no,
      to_char(h.logged_at, 'DD-MM-YY') AS date_label,
      COALESCE(NULLIF(trim(h.party_name), ''), '—') AS customer_name,
      COALESCE(NULLIF(trim(h.item_name), ''), '—') AS product,
      COALESCE(NULLIF(trim(h.serial), ''), '—') AS serial,
      COALESCE(NULLIF(trim(h.engineer_name), ''), '—') AS engineer,
      COALESCE(NULLIF(trim(h.complaint), ''), '—') AS complaint,
      COALESCE(NULLIF(trim(h.status_label), ''), '—') AS status
    FROM calls_latest_hot h
    LEFT JOIN dim_offices d ON d.ncode = h.nofficeid
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${clauses.filter(Boolean).join(' AND ')}
      ${SUMMARY_EXCLUDE_PRACTICE_OFFICE_SQL}
    ORDER BY h.logged_at DESC
    LIMIT 500
    `,
    ...values
  );

  return rows.map((row) => ({
    'Ref No': row.ref_no ?? '—',
    Date: row.date_label ?? '—',
    'Customer Name': row.customer_name ?? '—',
    Product: row.product ?? '—',
    Serial: row.serial ?? '—',
    Engineer: row.engineer ?? '—',
    Complaint: row.complaint ?? '—',
    Status: row.status ?? '—',
  }));
}
