import { describe, expect, it } from 'vitest';
import { buildAttendanceCsv, buildAttendanceListWhere } from '@/sql/attendance/list';

describe('buildAttendanceListWhere', () => {
  it('filters by IST date range and heading', () => {
    const { sql, values } = buildAttendanceListWhere({
      startDate: '2026-08-23',
      endDate: '2026-08-25',
      heading: 'Attendance',
      page: 1,
      limit: 50,
    });
    expect(sql).toContain('activity_date >=');
    expect(sql).toContain('heading = $');
    expect(values).toContain('2026-08-23T00:00:00+05:30');
    expect(values).toContain('2026-08-25T23:59:59.999+05:30');
    expect(values).toContain('Attendance');
  });
});

describe('buildAttendanceCsv', () => {
  it('emits header and escaped row', () => {
    const csv = buildAttendanceCsv([
      {
        activity_date: '2026-08-24T12:00:00.000Z',
        heading: 'Attendance',
        attd_user: 'A, B',
        office_name: 'Office',
        unique_call: null,
        trn_no: null,
        service_customer: null,
        sales_customer: null,
        attd_total_time: null,
        service_total_time: null,
        travel_mode: null,
        travel_total_time: null,
        expense_type: null,
        expense_amt: null,
        inquiry_no: null,
        expense_no: null,
        remarks: 'line1\nline2',
      },
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('activity_date,heading,attd_user');
    expect(csv).toContain('"A, B"');
    expect(csv).toContain('"line1\nline2"');
  });
});
