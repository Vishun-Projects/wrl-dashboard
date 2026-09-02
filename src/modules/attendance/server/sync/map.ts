import { parseCrmDate } from '@/lib/read-model/dates';

export type AttendanceDetailRow = {
  row_key: string;
  ncode: number;
  heading: string;
  activity_date: Date | null;
  activity_date_raw: string | null;
  activity_day: string | null;
  office_name: string | null;
  attd_user: string | null;
  user_id: number | null;
  office_id: number | null;
  attd_total_time: string | null;
  day_start: Date | null;
  day_end: Date | null;
  start_latlong: string | null;
  end_latlong: string | null;
  city_start: string | null;
  city_end: string | null;
  sales_customer: string | null;
  sales_meeting_start: Date | null;
  sales_meeting_end: Date | null;
  sales_total_time: string | null;
  iqv_start_latlong: string | null;
  iqv_end_latlong: string | null;
  inquiry_no: string | null;
  mobile: string | null;
  face_to_face: boolean | null;
  service_customer: string | null;
  unique_call: string | null;
  trn_no: string | null;
  service_meeting_start: Date | null;
  service_meeting_end: Date | null;
  service_total_time: string | null;
  visit_start_latlong: string | null;
  visit_end_latlong: string | null;
  remote_support: boolean | null;
  travel_mode: string | null;
  travel_start: Date | null;
  travel_end: Date | null;
  travel_total_time: string | null;
  attend_start_latlong: string | null;
  attend_end_latlong: string | null;
  expense_no: string | null;
  expense_date: Date | null;
  expense_type: string | null;
  expense_amt: number | null;
  remarks: string | null;
  expense_trn_no: string | null;
  customer_name: string | null;
  customer_latlong: string | null;
  customer_address: string | null;
};

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase());
    if (!actual) continue;
    const text = String(row[actual] ?? '').trim();
    if (text) return text;
  }
  return '';
}

function emptyToNull(value: string): string | null {
  return value || null;
}

function parseId(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function parseAmt(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseFlag(value: string): boolean | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === '-1') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return null;
}

export function attendanceRowKey(parts: {
  ncode: string;
  heading: string;
  uniqueCall: string;
  inquiryNo: string;
  expenseTrnNo: string;
  trnNo: string;
  serviceMeetingStart: string;
  salesMeetingStart: string;
  travelStart: string;
  dayStart: string;
}): string {
  return [
    parts.ncode,
    parts.heading,
    parts.uniqueCall,
    parts.inquiryNo,
    parts.expenseTrnNo,
    parts.trnNo,
    parts.serviceMeetingStart,
    parts.salesMeetingStart,
    parts.travelStart,
    parts.dayStart,
  ].join('|');
}

export function mapCrmAttendanceRow(raw: Record<string, unknown>): AttendanceDetailRow | null {
  const ncodeRaw = pick(raw, 'ncode');
  const heading = pick(raw, 'Heading', 'heading');
  const ncode = parseId(ncodeRaw);
  if (ncode == null || !heading) return null;

  const uniqueCall = pick(raw, 'uniquecall');
  const inquiryNo = pick(raw, 'inquiryno');
  const expenseTrnNo = pick(raw, 'nexpensetrnno');
  const trnNo = pick(raw, 'trnno');
  const serviceMeetingStartRaw = pick(raw, 'servicemeetingstart');
  const salesMeetingStartRaw = pick(raw, 'salesmeetingstart');
  const travelStartRaw = pick(raw, 'travelstart');
  const dayStartRaw = pick(raw, 'daystart');

  return {
    row_key: attendanceRowKey({
      ncode: String(ncode),
      heading,
      uniqueCall,
      inquiryNo,
      expenseTrnNo,
      trnNo,
      serviceMeetingStart: serviceMeetingStartRaw,
      salesMeetingStart: salesMeetingStartRaw,
      travelStart: travelStartRaw,
      dayStart: dayStartRaw,
    }),
    ncode,
    heading,
    activity_date: parseCrmDate(pick(raw, 'activitydate')),
    activity_date_raw: emptyToNull(pick(raw, 'activitydate')),
    activity_day: emptyToNull(pick(raw, 'activityday')),
    office_name: emptyToNull(pick(raw, 'officename')),
    attd_user: emptyToNull(pick(raw, 'attduser')),
    user_id: parseId(pick(raw, 'userid')),
    office_id: parseId(pick(raw, 'nofficeid')),
    attd_total_time: emptyToNull(pick(raw, 'attdtotaltime')),
    day_start: parseCrmDate(dayStartRaw),
    day_end: parseCrmDate(pick(raw, 'dayend')),
    start_latlong: emptyToNull(pick(raw, 'startlatlong')),
    end_latlong: emptyToNull(pick(raw, 'endlatlong')),
    city_start: emptyToNull(pick(raw, 'citystart')),
    city_end: emptyToNull(pick(raw, 'cityend')),
    sales_customer: emptyToNull(pick(raw, 'salescutomer')),
    sales_meeting_start: parseCrmDate(salesMeetingStartRaw),
    sales_meeting_end: parseCrmDate(pick(raw, 'salesmeetingend')),
    sales_total_time: emptyToNull(pick(raw, 'salestotaltime')),
    iqv_start_latlong: emptyToNull(pick(raw, 'iqvstartlatlong')),
    iqv_end_latlong: emptyToNull(pick(raw, 'iqvendlatlong')),
    inquiry_no: emptyToNull(inquiryNo),
    mobile: emptyToNull(pick(raw, 'mobile')),
    face_to_face: parseFlag(pick(raw, 'bfacetoface')),
    service_customer: emptyToNull(pick(raw, 'servicecutomer')),
    unique_call: emptyToNull(uniqueCall),
    trn_no: emptyToNull(trnNo),
    service_meeting_start: parseCrmDate(serviceMeetingStartRaw),
    service_meeting_end: parseCrmDate(pick(raw, 'servicemeetingend')),
    service_total_time: emptyToNull(pick(raw, 'servicetotaltime')),
    visit_start_latlong: emptyToNull(pick(raw, 'vstartlatlong')),
    visit_end_latlong: emptyToNull(pick(raw, 'vendlatlong')),
    remote_support: parseFlag(pick(raw, 'bremotesupport')),
    travel_mode: emptyToNull(pick(raw, 'travelmode')),
    travel_start: parseCrmDate(travelStartRaw),
    travel_end: parseCrmDate(pick(raw, 'travelend')),
    travel_total_time: emptyToNull(pick(raw, 'traveltotaltime')),
    attend_start_latlong: emptyToNull(pick(raw, 'vattendstartlatlong')),
    attend_end_latlong: emptyToNull(pick(raw, 'vattendendlatlong')),
    expense_no: emptyToNull(pick(raw, 'expnseno')),
    expense_date: parseCrmDate(pick(raw, 'expensedate')),
    expense_type: emptyToNull(pick(raw, 'expensetype')),
    expense_amt: parseAmt(pick(raw, 'expenseamt')),
    remarks: emptyToNull(pick(raw, 'vremarks')),
    expense_trn_no: emptyToNull(expenseTrnNo),
    customer_name: emptyToNull(pick(raw, 'customername')),
    customer_latlong: emptyToNull(pick(raw, 'customerlatlong')),
    customer_address: emptyToNull(pick(raw, 'customeraddress')),
  };
}
