import { prisma } from '@/lib/db/prisma';
import { escapeCsvCell } from '@/lib/utils/csv';

export type AttendanceListParams = {
  startDate: string;
  endDate: string;
  heading?: string;
  search?: string;
  page: number;
  limit: number;
};

export type AttendanceExportParams = Omit<AttendanceListParams, 'page' | 'limit'>;

/** Cap so a wide date export cannot OOM the API process. */
export const ATTENDANCE_EXPORT_MAX_ROWS = 100_000;

const ATTENDANCE_SELECT = `
  activity_date,
  heading,
  attd_user,
  office_name,
  unique_call,
  trn_no,
  service_customer,
  sales_customer,
  attd_total_time,
  service_total_time,
  travel_mode,
  travel_total_time,
  expense_type,
  expense_amt,
  inquiry_no,
  expense_no,
  remarks
`;

export type AttendanceListRow = {
  activity_date: Date | string | null;
  heading: string;
  attd_user: string | null;
  office_name: string | null;
  unique_call: string | null;
  trn_no: string | null;
  service_customer: string | null;
  sales_customer: string | null;
  attd_total_time: string | null;
  service_total_time: string | null;
  travel_mode: string | null;
  travel_total_time: string | null;
  expense_type: string | null;
  expense_amt: number | string | null;
  inquiry_no: string | null;
  expense_no: string | null;
  remarks: string | null;
};

function dateStartBound(date: string): string {
  return `${date}T00:00:00+05:30`;
}

function dateEndBound(date: string): string {
  return `${date}T23:59:59.999+05:30`;
}

export function buildAttendanceListWhere(params: AttendanceListParams): {
  sql: string;
  values: unknown[];
} {
  const clauses: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (params.startDate) {
    clauses.push(`activity_date >= $${idx}::timestamptz`);
    values.push(dateStartBound(params.startDate));
    idx++;
  }
  if (params.endDate) {
    clauses.push(`activity_date <= $${idx}::timestamptz`);
    values.push(dateEndBound(params.endDate));
    idx++;
  }
  if (params.heading && params.heading !== 'All') {
    clauses.push(`heading = $${idx}`);
    values.push(params.heading);
    idx++;
  }
  const q = params.search?.trim();
  if (q) {
    clauses.push(`(
      attd_user ILIKE $${idx}
      OR office_name ILIKE $${idx}
      OR unique_call ILIKE $${idx}
      OR trn_no ILIKE $${idx}
      OR service_customer ILIKE $${idx}
      OR sales_customer ILIKE $${idx}
    )`);
    values.push(`%${q}%`);
    idx++;
  }

  return { sql: clauses.join(' AND '), values };
}

export async function queryAttendanceList(params: AttendanceListParams): Promise<{
  total: number;
  rows: AttendanceListRow[];
}> {
  const { sql: whereSql, values } = buildAttendanceListWhere(params);
  const offset = (params.page - 1) * params.limit;
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT count(*)::int AS total FROM crm_attendance_details WHERE ${whereSql}`,
      ...values
    ),
    prisma.$queryRawUnsafe<AttendanceListRow[]>(
      `SELECT ${ATTENDANCE_SELECT}
       FROM crm_attendance_details
       WHERE ${whereSql}
       ORDER BY activity_date DESC NULLS LAST, ncode DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...values,
      params.limit,
      offset
    ),
  ]);

  return { total: countRows[0]?.total ?? 0, rows };
}

export async function queryAttendanceExport(
  params: AttendanceExportParams
): Promise<{ total: number; rows: AttendanceListRow[]; truncated: boolean }> {
  const { sql: whereSql, values } = buildAttendanceListWhere({
    ...params,
    page: 1,
    limit: ATTENDANCE_EXPORT_MAX_ROWS,
  });
  const limitIdx = values.length + 1;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafeBulk<Array<{ total: number }>>(
      `SELECT count(*)::int AS total FROM crm_attendance_details WHERE ${whereSql}`,
      ...values
    ),
    prisma.$queryRawUnsafeBulk<AttendanceListRow[]>(
      `SELECT ${ATTENDANCE_SELECT}
       FROM crm_attendance_details
       WHERE ${whereSql}
       ORDER BY activity_date DESC NULLS LAST, ncode DESC
       LIMIT $${limitIdx}`,
      ...values,
      ATTENDANCE_EXPORT_MAX_ROWS
    ),
  ]);

  const total = countRows[0]?.total ?? 0;
  return { total, rows, truncated: total > rows.length };
}

function csvDate(value: Date | string | null | undefined): string {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

export function buildAttendanceCsv(rows: AttendanceListRow[]): string {
  const header = [
    'activity_date',
    'heading',
    'attd_user',
    'office_name',
    'unique_call',
    'trn_no',
    'inquiry_no',
    'service_customer',
    'sales_customer',
    'attd_total_time',
    'service_total_time',
    'travel_mode',
    'travel_total_time',
    'expense_type',
    'expense_amt',
    'expense_no',
    'remarks',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvDate(row.activity_date),
        row.heading,
        row.attd_user,
        row.office_name,
        row.unique_call,
        row.trn_no,
        row.inquiry_no,
        row.service_customer,
        row.sales_customer,
        row.attd_total_time,
        row.service_total_time,
        row.travel_mode,
        row.travel_total_time,
        row.expense_type,
        row.expense_amt,
        row.expense_no,
        row.remarks,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
