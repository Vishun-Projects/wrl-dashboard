import { prisma } from '@/lib/db/prisma';
import { escapeCsvCell } from '@/lib/utils/csv';

export { mapsUrlFromLatLong } from '@/sql/attendance/maps-url';

export type UserLocationListParams = {
  startDate: string;
  endDate: string;
  search?: string;
  page: number;
  limit: number;
};

export type UserLocationExportParams = Omit<UserLocationListParams, 'page' | 'limit'>;

export const USER_LOCATION_EXPORT_MAX_ROWS = 100_000;

const LOCATION_SELECT = `
  l.ncode,
  l.user_id,
  l.office_id,
  l.latlong,
  l.added_on,
  l.action_type,
  l.distance,
  l.trn_no,
  l.customer_name,
  l.travel_mode,
  u.attd_user,
  o.vcompanyname AS office_name
`;

export type UserLocationListRow = {
  ncode: number | string;
  user_id: number | string | null;
  office_id: number | string | null;
  latlong: string | null;
  added_on: Date | string | null;
  action_type: string | null;
  distance: number | string | null;
  trn_no: string | null;
  customer_name: string | null;
  travel_mode: string | null;
  attd_user: string | null;
  office_name: string | null;
};

function dateStartBound(date: string): string {
  return `${date}T00:00:00+05:30`;
}

function dateEndBound(date: string): string {
  return `${date}T23:59:59.999+05:30`;
}

export function buildUserLocationListWhere(params: UserLocationListParams): {
  sql: string;
  values: unknown[];
} {
  const clauses: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (params.startDate) {
    clauses.push(`l.added_on >= $${idx}::timestamptz`);
    values.push(dateStartBound(params.startDate));
    idx++;
  }
  if (params.endDate) {
    clauses.push(`l.added_on <= $${idx}::timestamptz`);
    values.push(dateEndBound(params.endDate));
    idx++;
  }
  const q = params.search?.trim();
  if (q) {
    clauses.push(`(
      COALESCE(u.attd_user, '') ILIKE $${idx}
      OR COALESCE(o.vcompanyname, '') ILIKE $${idx}
      OR COALESCE(l.customer_name, '') ILIKE $${idx}
      OR COALESCE(l.trn_no, '') ILIKE $${idx}
      OR COALESCE(l.action_type, '') ILIKE $${idx}
      OR CAST(l.user_id AS text) ILIKE $${idx}
    )`);
    values.push(`%${q}%`);
    idx++;
  }

  return { sql: clauses.join(' AND '), values };
}

const LOCATION_FROM = `
  FROM crm_user_locations l
  LEFT JOIN LATERAL (
    SELECT a.attd_user
    FROM crm_attendance_details a
    WHERE a.user_id = l.user_id
      AND a.attd_user IS NOT NULL
      AND btrim(a.attd_user) <> ''
    ORDER BY a.activity_date DESC NULLS LAST
    LIMIT 1
  ) u ON true
  LEFT JOIN dim_offices o ON o.ncode = l.office_id
`;

export async function queryUserLocationList(
  params: UserLocationListParams
): Promise<{ rows: UserLocationListRow[]; total: number }> {
  const { sql: whereSql, values } = buildUserLocationListWhere(params);
  const offset = (params.page - 1) * params.limit;

  const countRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total ${LOCATION_FROM} WHERE ${whereSql}`,
    ...values
  )) as Array<{ total: number }>;

  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT ${LOCATION_SELECT}
    ${LOCATION_FROM}
    WHERE ${whereSql}
    ORDER BY l.added_on DESC NULLS LAST, l.ncode DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
    ...values,
    params.limit,
    offset
  )) as UserLocationListRow[];

  return { rows, total: countRows[0]?.total ?? 0 };
}

export async function queryUserLocationExport(
  params: UserLocationExportParams
): Promise<{ rows: UserLocationListRow[]; truncated: boolean; total: number }> {
  const listParams: UserLocationListParams = { ...params, page: 1, limit: USER_LOCATION_EXPORT_MAX_ROWS };
  const { sql: whereSql, values } = buildUserLocationListWhere(listParams);

  const countRows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total ${LOCATION_FROM} WHERE ${whereSql}`,
    ...values
  )) as Array<{ total: number }>;
  const total = countRows[0]?.total ?? 0;

  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT ${LOCATION_SELECT}
    ${LOCATION_FROM}
    WHERE ${whereSql}
    ORDER BY l.added_on DESC NULLS LAST, l.ncode DESC
    LIMIT $${values.length + 1}
    `,
    ...values,
    USER_LOCATION_EXPORT_MAX_ROWS
  )) as UserLocationListRow[];

  return { rows, truncated: total > rows.length, total };
}

export function buildUserLocationCsv(rows: UserLocationListRow[]): string {
  const header = [
    'added_on',
    'user',
    'user_id',
    'office',
    'action_type',
    'latlong',
    'distance',
    'trn_no',
    'customer',
    'travel_mode',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.added_on,
        row.attd_user,
        row.user_id,
        row.office_name,
        row.action_type,
        row.latlong,
        row.distance,
        row.trn_no,
        row.customer_name,
        row.travel_mode,
      ]
        .map((v) => escapeCsvCell(v == null ? '' : String(v)))
        .join(',')
    );
  }
  return lines.join('\n');
}
