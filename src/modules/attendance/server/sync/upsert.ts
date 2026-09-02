import type pg from 'pg';
import type { AttendanceDetailRow } from './map';

export const ATTENDANCE_COLUMNS = [
  'row_key',
  'ncode',
  'heading',
  'activity_date',
  'activity_date_raw',
  'activity_day',
  'office_name',
  'attd_user',
  'user_id',
  'office_id',
  'attd_total_time',
  'day_start',
  'day_end',
  'start_latlong',
  'end_latlong',
  'city_start',
  'city_end',
  'sales_customer',
  'sales_meeting_start',
  'sales_meeting_end',
  'sales_total_time',
  'iqv_start_latlong',
  'iqv_end_latlong',
  'inquiry_no',
  'mobile',
  'face_to_face',
  'service_customer',
  'unique_call',
  'trn_no',
  'service_meeting_start',
  'service_meeting_end',
  'service_total_time',
  'visit_start_latlong',
  'visit_end_latlong',
  'remote_support',
  'travel_mode',
  'travel_start',
  'travel_end',
  'travel_total_time',
  'attend_start_latlong',
  'attend_end_latlong',
  'expense_no',
  'expense_date',
  'expense_type',
  'expense_amt',
  'remarks',
  'expense_trn_no',
  'customer_name',
  'customer_latlong',
  'customer_address',
] as const;

const UPDATE_SET = ATTENDANCE_COLUMNS.filter((c) => c !== 'row_key')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('synced_at = now()')
  .join(', ');

function rowValues(row: AttendanceDetailRow): unknown[] {
  return ATTENDANCE_COLUMNS.map((c) => row[c]);
}

export async function upsertAttendanceDetails(
  client: pg.PoolClient,
  rows: AttendanceDetailRow[],
  batchSize = 80
): Promise<number> {
  if (rows.length === 0) return 0;
  const byKey = new Map<string, AttendanceDetailRow>();
  for (const row of rows) byKey.set(row.row_key, row);
  const deduped = Array.from(byKey.values());

  let upserted = 0;
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * ATTENDANCE_COLUMNS.length;
      placeholders.push(
        `(${ATTENDANCE_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues(row));
    });
    await client.query(
      `
      INSERT INTO crm_attendance_details (${ATTENDANCE_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (row_key) DO UPDATE SET ${UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }
  return upserted;
}
