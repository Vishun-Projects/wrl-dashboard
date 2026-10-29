import { prisma } from '@/lib/db/prisma';

export type OpsTrendDay = {
  date: string;
  /** logged that day (open_unallocated column) */
  open: number;
  /** logged that day */
  unallocated: number;
  /** unused for activity (0) */
  assigned: number;
  solved: number;
  cancelled: number;
  tech_solved: number;
  total: number;
};

/**
 * Period-summed activity for one call_type (table under chart).
 * `date` is the period end (not a single sealed day).
 */
export type OpsTrendCallTypePoint = {
  date: string;
  call_type: string;
  open: number;
  unallocated: number;
  assigned: number;
  solved: number;
  cancelled: number;
  tech_solved: number;
  total: number;
};

export type OpsTrendQueryParams = {
  startDate: string;
  endDate: string;
  assignedOffices?: string[];
  isHod?: boolean;
  callTypes?: string[];
  topCallTypes?: number;
};

type StatusSumRow = {
  as_of_date: string;
  open_unallocated: number;
  assigned: number;
  tech_solved: number;
  solved: number;
  cancelled: number;
  total: number;
};

type CallTypeSumRow = StatusSumRow & { call_type: string };

/** Match MIS rollups: exclude practice / WinMax / HO-1100 via dim_offices name. */
const SNAPSHOT_EXCLUDE_PRACTICE_SQL = `AND COALESCE(d.vcompanyname, '') !~* '(PRACTICE|WINMAX|WESTERN\\s+HEAD\\s+OFFICE\\s*-\\s*1100)'`;

/** open / unallocated = logged that day (activity); assigned unused. */
export function toTrendDay(row: StatusSumRow): OpsTrendDay {
  const unallocated = Number(row.open_unallocated);
  const assigned = Number(row.assigned);
  return {
    date: String(row.as_of_date).slice(0, 10),
    open: unallocated,
    unallocated,
    assigned,
    solved: Number(row.solved),
    cancelled: Number(row.cancelled),
    tech_solved: Number(row.tech_solved),
    total: Number(row.total),
  };
}

export function toTrendCallTypePoint(row: CallTypeSumRow): OpsTrendCallTypePoint {
  const day = toTrendDay(row);
  return {
    date: day.date,
    call_type: row.call_type,
    open: day.open,
    unallocated: day.unallocated,
    assigned: day.assigned,
    solved: day.solved,
    cancelled: day.cancelled,
    tech_solved: day.tech_solved,
    total: day.total,
  };
}

/** Rank call types by volume; stable alphabetical tie-break. */
export function selectTopCallTypes(
  totals: Array<{ call_type: string; total: number }>,
  limit = 8
): string[] {
  return [...totals]
    .sort((a, b) => b.total - a.total || a.call_type.localeCompare(b.call_type))
    .slice(0, Math.max(0, limit))
    .map((r) => r.call_type);
}

function buildOfficeClause(
  params: OpsTrendQueryParams,
  startIdx: number
): { clause: string; values: unknown[]; nextIdx: number } {
  if (params.isHod || !params.assignedOffices?.length) {
    return { clause: '', values: [], nextIdx: startIdx };
  }
  return {
    clause: `AND (
      s.office_id = ANY($${startIdx}::bigint[])
      OR EXISTS (
        SELECT 1 FROM dim_offices o
        WHERE o.ncode = s.office_id
          AND o.nunder = ANY($${startIdx}::bigint[])
      )
    )`,
    values: [params.assignedOffices.map((id) => Number(id))],
    nextIdx: startIdx + 1,
  };
}

function buildCallTypeClause(
  params: OpsTrendQueryParams,
  startIdx: number
): { clause: string; values: unknown[]; nextIdx: number } {
  if (!params.callTypes?.length) {
    return { clause: '', values: [], nextIdx: startIdx };
  }
  return {
    clause: `AND upper(trim(s.call_type)) = ANY($${startIdx}::text[])`,
    values: [params.callTypes.map((t) => String(t).trim().toUpperCase())],
    nextIdx: startIdx + 1,
  };
}

const STATUS_SUM_SELECT = `
  COALESCE(SUM(s.open_unallocated), 0)::int AS open_unallocated,
  COALESCE(SUM(s.assigned), 0)::int AS assigned,
  COALESCE(SUM(s.tech_solved), 0)::int AS tech_solved,
  COALESCE(SUM(s.solved), 0)::int AS solved,
  COALESCE(SUM(s.cancelled), 0)::int AS cancelled,
  COALESCE(SUM(s.total), 0)::int AS total
`;

export async function queryOpsStatusTrend(params: OpsTrendQueryParams): Promise<{
  days: OpsTrendDay[];
  callTypes: OpsTrendCallTypePoint[];
  topTypes: string[];
}> {
  const topN = params.topCallTypes ?? 8;
  const office = buildOfficeClause(params, 3);
  const callType = buildCallTypeClause(params, office.nextIdx);
  const values = [params.startDate, params.endDate, ...office.values, ...callType.values];

  const scopedFrom = `
    FROM ops_status_snapshot_daily s
    LEFT JOIN dim_offices d ON d.ncode = s.office_id
    WHERE s.as_of_date >= $1::date
      AND s.as_of_date <= $2::date
      ${office.clause}
      ${callType.clause}
      ${SNAPSHOT_EXCLUDE_PRACTICE_SQL}
  `;

  const [statusRows, typeTotalRows] = await Promise.all([
    prisma.$queryRawUnsafeBulk<StatusSumRow[]>(
      `
      SELECT
        s.as_of_date::text AS as_of_date,
        ${STATUS_SUM_SELECT}
      ${scopedFrom}
      GROUP BY s.as_of_date
      ORDER BY s.as_of_date ASC
      `,
      ...values
    ),
    prisma.$queryRawUnsafeBulk<Array<{ call_type: string; total: number }>>(
      `
      SELECT
        s.call_type,
        COALESCE(SUM(s.total), 0)::int AS total
      ${scopedFrom}
      GROUP BY s.call_type
      ORDER BY total DESC, s.call_type ASC
      `,
      ...values
    ),
  ]);

  const topTypes = selectTopCallTypes(typeTotalRows, topN);
  let callTypes: OpsTrendCallTypePoint[] = [];

  if (topTypes.length > 0) {
    const typeIdx = callType.nextIdx;
    const typeValues = [...values, topTypes];
    // Period sum per call type (not latest sealed day stock).
    const rows = await prisma.$queryRawUnsafeBulk<CallTypeSumRow[]>(
      `
      SELECT
        $2::text AS as_of_date,
        s.call_type,
        ${STATUS_SUM_SELECT}
      ${scopedFrom}
        AND s.call_type = ANY($${typeIdx}::text[])
      GROUP BY s.call_type
      ORDER BY total DESC, s.call_type ASC
      `,
      ...typeValues
    );
    callTypes = rows.map(toTrendCallTypePoint);
  }

  return {
    days: statusRows.map(toTrendDay),
    callTypes,
    topTypes,
  };
}
