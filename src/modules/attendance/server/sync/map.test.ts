import { describe, expect, it } from 'vitest';
import { attendanceRowKey, mapCrmAttendanceRow } from './map';

describe('mapCrmAttendanceRow', () => {
  it('builds a stable row_key from ncode + heading + meeting stamp', () => {
    const row = mapCrmAttendanceRow({
      ncode: '76',
      Heading: 'Work Done - Service',
      uniquecall: '26H05036',
      trnno: '26H05036',
      servicemeetingstart: '22/08/2026 13:05:26',
      activitydate: '22/08/2026 00:30:51',
      userid: '133.200000000',
      nofficeid: '133',
    });
    expect(row?.ncode).toBe(76);
    expect(row?.user_id).toBe(133);
    expect(row?.unique_call).toBe('26H05036');
    expect(row?.row_key).toBe(
      attendanceRowKey({
        ncode: '76',
        heading: 'Work Done - Service',
        uniqueCall: '26H05036',
        inquiryNo: '',
        expenseTrnNo: '',
        trnNo: '26H05036',
        serviceMeetingStart: '22/08/2026 13:05:26',
        salesMeetingStart: '',
        travelStart: '',
        dayStart: '',
      })
    );
  });

  it('keeps two visits to the same call as distinct keys', () => {
    const a = mapCrmAttendanceRow({
      ncode: '76',
      Heading: 'Work Done - Service',
      uniquecall: '26H05036',
      trnno: '26H05036',
      servicemeetingstart: '22/08/2026 13:05:26',
    });
    const b = mapCrmAttendanceRow({
      ncode: '76',
      Heading: 'Work Done - Service',
      uniquecall: '26H05036',
      trnno: '26H05036',
      servicemeetingstart: '22/08/2026 13:34:04',
    });
    expect(a?.row_key).not.toBe(b?.row_key);
  });

  it('skips rows without ncode/heading', () => {
    expect(mapCrmAttendanceRow({ Heading: 'Attendance' })).toBeNull();
    expect(mapCrmAttendanceRow({ ncode: '1' })).toBeNull();
  });
});
