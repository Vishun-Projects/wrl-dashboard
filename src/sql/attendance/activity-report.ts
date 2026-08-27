import { prisma } from '@/lib/db/prisma';
import { postQuery } from '@/lib/db/proxy';
import { escapeCsvCell } from '@/lib/utils/csv';
import {
  calculateActivityMetrics,
  formatDurationMinutes,
  pickActivityLatLong,
  toMs,
  type ActivityIndication,
} from '@/sql/attendance/activity-metrics';
import type { AttendanceSettings } from '@/modules/attendance/services/org-settings-defaults';
import {
  buildCallKeysWithRepairDoneSql,
  buildDistinctRepairDoneByCallKeysSql,
  buildFullRepairDoneByCallKeysSql,
} from '@/sql/trhcalls/query';

export function dateStartBound(date: string): string {
  return `${date}T00:00:00+05:30`;
}

export function dateEndBound(date: string): string {
  return `${date}T23:59:59.999+05:30`;
}

export type SearchBy =
  | 'call'
  | 'serial'
  | 'call_number'
  | 'office'
  | 'technician';

export type ActivityCallKey = { ncode: number; officeId: number };

export type ActivityReportParams = {
  searchBy?: SearchBy | '';
  q?: string;
  officeIds?: number[];
  callTypes?: string[];
  officeNames?: string[];
  technicianNames?: string[];
  callNos?: string[];
  serialNos?: string[];
  /** Exact mstrepair.vname values; resolved to call keys via CRM before paging. */
  repairDones?: string[];
  /** Pre-resolved (ncode, office) pairs for repairDones filter. */
  repairCallKeys?: ActivityCallKey[];
  callDateFrom?: string;
  callDateTo?: string;
  activityDateFrom: string;
  activityDateTo: string;
  page: number;
  pageSize: number;
};

export const ACTIVITY_REPORT_EXPORT_MAX_ROWS = 100_000;

export type ActivityReportRawRow = {
  row_key: string;
  ncode: number | string | null;
  office_id: number | string | null;
  office_name: string | null;
  user_id: number | string | null;
  attd_user: string | null;
  activity_date: Date | string | null;
  activity_day: string;
  heading: string;
  unique_call: string | null;
  trn_no: string | null;
  call_no: string | null;
  call_type: string | null;
  serial: string | null;
  call_ncode: number | string | null;
  call_office_id: number | string | null;
  call_logged_at: Date | string | null;
  service_meeting_start: Date | string | null;
  service_meeting_end: Date | string | null;
  service_total_time: string | null;
  day_start: Date | string | null;
  day_end: Date | string | null;
  travel_start: Date | string | null;
  travel_end: Date | string | null;
  travel_mode: string | null;
  travel_total_time: string | null;
  expense_amt: number | string | null;
  expense_type: string | null;
  remarks: string | null;
  service_customer: string | null;
  sales_customer: string | null;
  customer_name: string | null;
  visit_start_latlong: string | null;
  attend_start_latlong: string | null;
  start_latlong: string | null;
  customer_latlong: string | null;
  act_start: Date | string | null;
  prev_act_start: Date | string | null;
  prev_visit_start_latlong: string | null;
  prev_attend_start_latlong: string | null;
  prev_start_latlong: string | null;
  prev_customer_latlong: string | null;
  total_count?: number;
};

export type ActivityReportCrmSnapshot = {
  activity_date: Date | string | null;
  day_start: Date | string | null;
  day_end: Date | string | null;
  service_meeting_start: Date | string | null;
  service_meeting_end: Date | string | null;
  service_total_time: string | null;
  travel_start: Date | string | null;
  travel_end: Date | string | null;
  travel_total_time: string | null;
  expense_amt: number | null;
  expense_type: string | null;
  visit_start_latlong: string | null;
  attend_start_latlong: string | null;
  start_latlong: string | null;
  customer_latlong: string | null;
  /** Inputs we used for LAG (not CRM columns, but raw before metrics). */
  act_start: Date | string | null;
  prev_act_start: Date | string | null;
  prev_latlong: string | null;
};

export type ActivityReportRow = {
  row_key: string;
  office_id: number | null;
  office_name: string | null;
  user_id: number | null;
  technician: string | null;
  activity_date: Date | string | null;
  activity_day: string;
  call_no: string | null;
  call_type: string | null;
  serial: string | null;
  repair_done: string | null;
  latlong: string | null;
  distance_km: number | null;
  time1_minutes: number | null;
  time2_minutes: number | null;
  time3_minutes: number | null;
  expense_claimed: number | null;
  approx_minutes: number | null;
  indication: ActivityIndication;
  call_ncode: number | null;
  call_office_id: number | null;
  service_customer: string | null;
  remarks: string | null;
  time_adjusted: boolean;
  idle_gap: boolean;
  expected_travel_minutes: number | null;
  excess_gap_minutes: number | null;
  crm: ActivityReportCrmSnapshot;
};

export type RelatedActivityRow = {
  activity_time: Date | string | null;
  activity_type: string;
  call_no: string | null;
  call_type: string | null;
  latlong: string | null;
  distance_from_prev_km: number | null;
  duration_gap_minutes: number | null;
  remarks: string | null;
  /** Raw CRM timestamp for this event before we rewrote it (null if same / N/A). */
  crm_time: Date | string | null;
  crm_service_total_time: string | null;
  time_derived: boolean;
};

export type OfficeOption = {
  office_id: number;
  office_name: string;
};

function parseSearchBy(raw: string | undefined | null): SearchBy | '' {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (v === 'call' || v === 'serial' || v === 'call_number' || v === 'office' || v === 'technician') {
    return v;
  }
  return '';
}

/** Attendance-table predicates (alias `a`). Hot filters use alias `h`. */
function buildAttendanceWhere(
  params: Pick<
    ActivityReportParams,
    | 'searchBy'
    | 'q'
    | 'officeIds'
    | 'callDateFrom'
    | 'callDateTo'
    | 'callTypes'
    | 'officeNames'
    | 'technicianNames'
    | 'callNos'
    | 'serialNos'
    | 'repairCallKeys'
  >,
  startIdx: number
): { clause: string; values: unknown[]; nextIdx: number; joinHot: boolean } {
  const clauses: string[] = [
    `a.heading = 'Work Done - Service'`,
    `a.activity_date >= $1::timestamptz`,
    `a.activity_date <= $2::timestamptz`,
    // Activity report: only tech-solved or solved calls (never open / cancelled / etc).
    `h.status_bucket IN ('tech_solved', 'solved')`,
  ];
  const values: unknown[] = [];
  let idx = startIdx;
  const joinHot = true;

  if (params.officeIds?.length) {
    clauses.push(`a.office_id = ANY($${idx}::bigint[])`);
    values.push(params.officeIds);
    idx++;
  }

  if (params.callTypes?.length) {
    clauses.push(`upper(btrim(COALESCE(h.call_type, ''))) = ANY($${idx}::text[])`);
    values.push(params.callTypes.map((t) => t.trim().toUpperCase()).filter(Boolean));
    idx++;
  }
  if (params.officeNames?.length) {
    clauses.push(`upper(btrim(COALESCE(a.office_name, ''))) = ANY($${idx}::text[])`);
    values.push(params.officeNames.map((t) => t.trim().toUpperCase()).filter(Boolean));
    idx++;
  }
  if (params.technicianNames?.length) {
    clauses.push(`upper(btrim(COALESCE(a.attd_user, ''))) = ANY($${idx}::text[])`);
    values.push(params.technicianNames.map((t) => t.trim().toUpperCase()).filter(Boolean));
    idx++;
  }
  if (params.callNos?.length) {
    clauses.push(
      `upper(btrim(COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), '')))) = ANY($${idx}::text[])`
    );
    values.push(params.callNos.map((t) => t.trim().toUpperCase()).filter(Boolean));
    idx++;
  }
  if (params.serialNos?.length) {
    clauses.push(`upper(btrim(COALESCE(h.serial, ''))) = ANY($${idx}::text[])`);
    values.push(params.serialNos.map((t) => t.trim().toUpperCase()).filter(Boolean));
    idx++;
  }
  if (params.repairCallKeys) {
    if (!params.repairCallKeys.length) {
      clauses.push('FALSE');
    } else {
      clauses.push(`EXISTS (
        SELECT 1
        FROM unnest($${idx}::bigint[], $${idx + 1}::bigint[]) AS rk(ncode, nofficeid)
        WHERE rk.ncode = h.ncode AND rk.nofficeid = h.nofficeid
      )`);
      values.push(params.repairCallKeys.map((k) => k.ncode));
      values.push(params.repairCallKeys.map((k) => k.officeId));
      idx += 2;
    }
  }

  if (params.callDateFrom) {
    clauses.push(`h.logged_at >= $${idx}::timestamptz`);
    values.push(dateStartBound(params.callDateFrom));
    idx++;
  }
  if (params.callDateTo) {
    clauses.push(`h.logged_at <= $${idx}::timestamptz`);
    values.push(dateEndBound(params.callDateTo));
    idx++;
  }

  const q = params.q?.trim() ?? '';
  const searchBy = parseSearchBy(params.searchBy);
  if (q && searchBy) {
    const like = `%${q}%`;
    if (searchBy === 'call' || searchBy === 'call_number') {
      clauses.push(`(
        COALESCE(a.trn_no, '') ILIKE $${idx}
        OR COALESCE(a.unique_call, '') ILIKE $${idx}
      )`);
      values.push(like);
      idx++;
    } else if (searchBy === 'serial') {
      clauses.push(`COALESCE(h.serial, '') ILIKE $${idx}`);
      values.push(like);
      idx++;
    } else if (searchBy === 'office') {
      clauses.push(`COALESCE(a.office_name, '') ILIKE $${idx}`);
      values.push(like);
      idx++;
    } else if (searchBy === 'technician') {
      clauses.push(`COALESCE(a.attd_user, '') ILIKE $${idx}`);
      values.push(like);
      idx++;
    }
  } else if (q) {
    clauses.push(`(
      COALESCE(a.trn_no, '') ILIKE $${idx}
      OR COALESCE(a.unique_call, '') ILIKE $${idx}
      OR COALESCE(a.office_name, '') ILIKE $${idx}
      OR COALESCE(a.attd_user, '') ILIKE $${idx}
      OR COALESCE(h.serial, '') ILIKE $${idx}
    )`);
    values.push(`%${q}%`);
    idx++;
  }

  return {
    clause: clauses.join(' AND '),
    values,
    nextIdx: idx,
    joinHot,
  };
}

const ATT_SELECT = `
  a.row_key,
  a.ncode,
  a.office_id,
  a.office_name,
  a.user_id,
  a.attd_user,
  a.activity_date,
  to_char((a.activity_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS activity_day,
  a.heading,
  a.unique_call,
  a.trn_no,
  COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), '')) AS call_no,
  a.service_meeting_start,
  a.service_meeting_end,
  a.service_total_time,
  a.day_start,
  a.day_end,
  a.travel_start,
  a.travel_end,
  a.travel_mode,
  a.travel_total_time,
  a.expense_amt,
  a.expense_type,
  a.remarks,
  a.service_customer,
  a.sales_customer,
  a.customer_name,
  a.visit_start_latlong,
  a.attend_start_latlong,
  a.start_latlong,
  a.customer_latlong,
  CASE
    WHEN a.service_meeting_start IS NOT NULL
      AND a.service_meeting_end IS NOT NULL
      AND a.service_meeting_start = a.service_meeting_end
      AND (a.service_meeting_start AT TIME ZONE 'UTC')::time = TIME '21:30:00'
    THEN COALESCE(a.day_start, a.travel_start, a.activity_date)
    ELSE COALESCE(
      a.service_meeting_start,
      a.day_start,
      a.travel_start,
      a.activity_date
    )
  END AS act_start
`;

/** PK-friendly call join key (no upper/btrim on hot side). */
const HOT_JOIN = `
  LEFT JOIN calls_latest_hot h
    ON h.vtrnno = COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), ''))
`;

const HOT_SELECT = `
  h.call_type,
  h.serial,
  h.ncode AS call_ncode,
  h.nofficeid AS call_office_id,
  h.logged_at AS call_logged_at
`;

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRawToReportRow(
  raw: ActivityReportRawRow,
  repairDone: string | null,
  settings: AttendanceSettings,
  arcpByCall: Map<string, ArcpCallFacts>
): ActivityReportRow {
  const latlong = pickActivityLatLong(raw);
  const prevLatlong = pickActivityLatLong({
    visit_start_latlong: raw.prev_visit_start_latlong,
    attend_start_latlong: raw.prev_attend_start_latlong,
    start_latlong: raw.prev_start_latlong,
    customer_latlong: raw.prev_customer_latlong,
  });
  const callKey = String(raw.call_no ?? '').trim().toUpperCase();
  const arcp = callKey ? arcpByCall.get(callKey) : undefined;
  const calc = calculateActivityMetrics({
    latlong,
    prevLatlong,
    actStart: raw.act_start,
    prevActStart: raw.prev_act_start,
    repairStart: raw.service_meeting_start,
    repairEnd: raw.service_meeting_end,
    activityDate: raw.activity_date,
    serviceTotalTime: raw.service_total_time,
    travelStart: raw.travel_start,
    travelEnd: raw.travel_end,
    travelTotalTime: raw.travel_total_time,
    repairDone,
    settings,
    distanceKm: arcp?.distanceKm ?? null,
  });
  return {
    row_key: raw.row_key,
    office_id: toNum(raw.office_id),
    office_name: raw.office_name,
    user_id: toNum(raw.user_id),
    technician: raw.attd_user,
    activity_date: raw.activity_date,
    activity_day: raw.activity_day,
    call_no: raw.call_no,
    call_type: raw.call_type,
    serial: raw.serial,
    repair_done: repairDone,
    latlong,
    distance_km: calc.distanceKm,
    time1_minutes: calc.time1Minutes,
    time2_minutes: calc.time2Minutes,
    time3_minutes: calc.time3Minutes,
    expense_claimed: arcp?.amountClaimed ?? null,
    approx_minutes: calc.approxMinutes,
    indication: calc.indication,
    call_ncode: toNum(raw.call_ncode),
    call_office_id: toNum(raw.call_office_id),
    service_customer: raw.service_customer || raw.sales_customer || raw.customer_name,
    remarks: raw.remarks,
    time_adjusted: calc.timeAdjusted === true,
    idle_gap: calc.idleGap === true,
    expected_travel_minutes: calc.expectedTravelMinutes ?? null,
    excess_gap_minutes: calc.excessGapMinutes ?? null,
    crm: {
      activity_date: raw.activity_date,
      day_start: raw.day_start,
      day_end: raw.day_end,
      service_meeting_start: raw.service_meeting_start,
      service_meeting_end: raw.service_meeting_end,
      service_total_time: raw.service_total_time,
      travel_start: raw.travel_start,
      travel_end: raw.travel_end,
      travel_total_time: raw.travel_total_time,
      expense_amt: toNum(raw.expense_amt),
      expense_type: raw.expense_type,
      visit_start_latlong: raw.visit_start_latlong,
      attend_start_latlong: raw.attend_start_latlong,
      start_latlong: raw.start_latlong,
      customer_latlong: raw.customer_latlong,
      act_start: raw.act_start,
      prev_act_start: raw.prev_act_start,
      prev_latlong: prevLatlong,
    },
  };
}

const ARCP_CALL_CHUNK = 80;

function sqlCallKeyInList(keys: string[]): string {
  return keys.map((k) => `'${String(k).replace(/'/g, "''")}'`).join(',');
}

type ArcpCallFacts = {
  distanceKm: number | null;
  amountClaimed: number | null;
};

/**
 * Per call from trdcalls10ARCP (vucnno = call no):
 * - Dist km = MAX(ndistance) on travel lines
 * - Expense ₹ = SUM(nchargespayable)
 */
async function fetchArcpFactsByCallKeys(callKeys: string[]): Promise<Map<string, ArcpCallFacts>> {
  const byKey = new Map<string, ArcpCallFacts>();
  const keys = [...new Set(callKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
  if (!keys.length) return byKey;

  try {
    for (let i = 0; i < keys.length; i += ARCP_CALL_CHUNK) {
      const chunk = keys.slice(i, i + ARCP_CALL_CHUNK);
      const res = await postQuery({
        rawSql: `
          SELECT
            UPPER(LTRIM(RTRIM(CAST(vucnno AS VARCHAR(50))))) AS call_key,
            MAX(TRY_CONVERT(float, ndistance)) AS distance_km,
            SUM(TRY_CONVERT(float, nchargespayable)) AS amount_claimed
          FROM trdcalls10ARCP WITH (NOLOCK)
          WHERE NULLIF(LTRIM(RTRIM(CAST(vucnno AS VARCHAR(50)))), '') IS NOT NULL
            AND UPPER(LTRIM(RTRIM(CAST(vucnno AS VARCHAR(50))))) IN (${sqlCallKeyInList(chunk)})
          GROUP BY UPPER(LTRIM(RTRIM(CAST(vucnno AS VARCHAR(50)))))
        `,
        timeoutMs: 45_000,
      });
      for (const row of (res.data || []) as Array<Record<string, unknown>>) {
        const key = String(row.call_key ?? '').trim().toUpperCase();
        if (!key) continue;
        byKey.set(key, {
          distanceKm: toNum(row.distance_km),
          amountClaimed: toNum(row.amount_claimed),
        });
      }
    }
  } catch {
    // ponytail: CRM down → Dist/Expense N/A; page still loads
  }
  return byKey;
}

const REPAIR_CALL_CHUNK = 80;
/** Cap call-key fan-out for repair filter/options (CRM IN lists). */
const REPAIR_KEY_CAP = 5_000;

async function enrichRepairDone(rows: ActivityReportRawRow[]): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  const keyed = rows
    .map((r) => ({
      row_key: r.row_key,
      ncode: toNum(r.call_ncode),
      officeId: toNum(r.call_office_id),
    }))
    .filter((r) => r.ncode != null && r.officeId != null) as Array<{
    row_key: string;
    ncode: number;
    officeId: number;
  }>;
  if (!keyed.length) return byKey;

  const doneByCall = new Map<string, string>();
  try {
    for (let i = 0; i < keyed.length; i += REPAIR_CALL_CHUNK) {
      const chunk = keyed.slice(i, i + REPAIR_CALL_CHUNK);
      const rawSql = buildFullRepairDoneByCallKeysSql(
        chunk.map((k) => ({ ncode: k.ncode, officeId: k.officeId }))
      );
      if (!rawSql) continue;
      const res = await postQuery({ rawSql, timeoutMs: 45_000 });
      for (const row of (res.data || []) as Array<Record<string, unknown>>) {
        const n = toNum(row.id);
        const o = toNum(row.office_id);
        const done = String(row.repair_done ?? '').trim();
        if (n == null || o == null || !done) continue;
        doneByCall.set(`${n}:${o}`, done);
      }
    }
  } catch {
    // ponytail: CRM down → Repair blank; page still loads
    return byKey;
  }

  for (const row of keyed) {
    const done = doneByCall.get(`${row.ncode}:${row.officeId}`);
    if (done) byKey.set(row.row_key, done);
  }
  return byKey;
}

async function queryMatchingCallKeys(
  params: Omit<ActivityReportParams, 'page' | 'pageSize' | 'repairDones' | 'repairCallKeys'>
): Promise<ActivityCallKey[]> {
  const where = buildAttendanceWhere({ ...params, repairCallKeys: undefined }, 3);
  const rows = await prisma.$queryRawUnsafe<Array<{ ncode: number | string; nofficeid: number | string }>>(
    `
    SELECT DISTINCT h.ncode, h.nofficeid
    FROM crm_attendance_details a
    ${HOT_JOIN}
    WHERE ${where.clause}
      AND h.ncode IS NOT NULL
      AND h.nofficeid IS NOT NULL
    LIMIT ${REPAIR_KEY_CAP}
    `,
    dateStartBound(params.activityDateFrom),
    dateEndBound(params.activityDateTo),
    ...where.values
  );
  return rows
    .map((r) => ({ ncode: Number(r.ncode), officeId: Number(r.nofficeid) }))
    .filter((k) => Number.isFinite(k.ncode) && k.ncode > 0 && Number.isFinite(k.officeId) && k.officeId > 0);
}

async function filterCallKeysByRepairDone(
  keys: ActivityCallKey[],
  repairDones: string[]
): Promise<ActivityCallKey[]> {
  const names = repairDones.map((n) => n.trim()).filter(Boolean);
  if (!keys.length || !names.length) return [];
  const matched = new Map<string, ActivityCallKey>();
  try {
    for (let i = 0; i < keys.length; i += REPAIR_CALL_CHUNK) {
      const chunk = keys.slice(i, i + REPAIR_CALL_CHUNK);
      const rawSql = buildCallKeysWithRepairDoneSql(chunk, names);
      if (!rawSql) continue;
      const res = await postQuery({ rawSql, timeoutMs: 45_000 });
      for (const row of (res.data || []) as Array<Record<string, unknown>>) {
        const n = toNum(row.id);
        const o = toNum(row.office_id);
        if (n == null || o == null) continue;
        matched.set(`${n}:${o}`, { ncode: n, officeId: o });
      }
    }
  } catch {
    return [];
  }
  return [...matched.values()];
}

async function resolveRepairFilterParams(
  params: Omit<ActivityReportParams, 'page' | 'pageSize'> &
    Partial<Pick<ActivityReportParams, 'page' | 'pageSize'>>
): Promise<typeof params> {
  const names = (params.repairDones ?? []).map((n) => n.trim()).filter(Boolean);
  if (!names.length) return { ...params, repairCallKeys: undefined };
  const candidates = await queryMatchingCallKeys({
    searchBy: params.searchBy,
    q: params.q,
    officeIds: params.officeIds,
    callTypes: params.callTypes,
    officeNames: params.officeNames,
    technicianNames: params.technicianNames,
    callNos: params.callNos,
    serialNos: params.serialNos,
    callDateFrom: params.callDateFrom,
    callDateTo: params.callDateTo,
    activityDateFrom: params.activityDateFrom,
    activityDateTo: params.activityDateTo,
  });
  const repairCallKeys = await filterCallKeysByRepairDone(candidates, names);
  return { ...params, repairCallKeys };
}

/**
 * Page first on attendance (index-friendly), attach hot via PK, then LAG only for
 * (user_id, day) peers of the page — not the full date range.
 */
async function queryPagedActivityRaw(
  params: ActivityReportParams
): Promise<{ total: number; rows: ActivityReportRawRow[] }> {
  const where = buildAttendanceWhere(params, 3);
  const fromJoin = HOT_JOIN;

  const countValues: unknown[] = [
    dateStartBound(params.activityDateFrom),
    dateEndBound(params.activityDateTo),
    ...where.values,
  ];
  const pageValues: unknown[] = [
    ...countValues,
    params.pageSize,
    (params.page - 1) * params.pageSize,
  ];
  const limitIdx = where.nextIdx;
  const offsetIdx = where.nextIdx + 1;

  const [countRows, pageRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `
      SELECT count(*)::int AS total
      FROM crm_attendance_details a
      ${where.joinHot ? fromJoin : ''}
      WHERE ${where.clause}
      `,
      ...countValues
    ),
    prisma.$queryRawUnsafe<ActivityReportRawRow[]>(
      `
      SELECT ${ATT_SELECT}, ${HOT_SELECT}
      FROM crm_attendance_details a
      ${fromJoin}
      WHERE ${where.clause}
      ORDER BY a.activity_date DESC NULLS LAST,
        COALESCE(a.service_meeting_start, a.day_start, a.travel_start, a.activity_date) DESC NULLS LAST,
        a.row_key
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      ...pageValues
    ),
  ]);

  const total = countRows[0]?.total ?? 0;
  if (!pageRows.length) return { total, rows: [] };

  const peerKeys = [
    ...new Map(
      pageRows
        .filter((r) => r.user_id != null && r.activity_day)
        .map((r) => [
          `${r.user_id}|${r.activity_day}`,
          { userId: Number(r.user_id), day: r.activity_day },
        ])
    ).values(),
  ];

  type PeerRow = {
    row_key: string;
    user_id: number | string;
    activity_day: string;
    act_start: Date | string | null;
    visit_start_latlong: string | null;
    attend_start_latlong: string | null;
    start_latlong: string | null;
    customer_latlong: string | null;
    prev_act_start: Date | string | null;
    prev_visit_start_latlong: string | null;
    prev_attend_start_latlong: string | null;
    prev_start_latlong: string | null;
    prev_customer_latlong: string | null;
  };

  let peerByKey = new Map<string, PeerRow>();
  if (peerKeys.length) {
    const userIds = [...new Set(peerKeys.map((p) => p.userId))];
    const days = [...new Set(peerKeys.map((p) => p.day))].sort();
    const peers = (await prisma.$queryRawUnsafe(
      `
      WITH peer_base AS (
        SELECT
          a.row_key,
          a.user_id,
          COALESCE(a.attd_user, '') AS attd_user,
          to_char((a.activity_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS activity_day,
          CASE
            WHEN a.service_meeting_start IS NOT NULL
              AND a.service_meeting_end IS NOT NULL
              AND a.service_meeting_start = a.service_meeting_end
              AND (a.service_meeting_start AT TIME ZONE 'UTC')::time = TIME '21:30:00'
            THEN COALESCE(a.day_start, a.travel_start, a.activity_date)
            ELSE COALESCE(
              a.service_meeting_start,
              a.day_start,
              a.travel_start,
              a.activity_date
            )
          END AS act_start,
          a.visit_start_latlong,
          a.attend_start_latlong,
          a.start_latlong,
          a.customer_latlong
        FROM crm_attendance_details a
        WHERE a.heading = 'Work Done - Service'
          AND a.user_id = ANY($1::bigint[])
          AND a.activity_date >= $2::timestamptz
          AND a.activity_date <= $3::timestamptz
      )
      SELECT
        p.*,
        LAG(p.act_start) OVER (
          PARTITION BY p.user_id, p.attd_user, p.activity_day
          ORDER BY p.act_start NULLS LAST, p.row_key
        ) AS prev_act_start,
        LAG(p.visit_start_latlong) OVER (
          PARTITION BY p.user_id, p.attd_user, p.activity_day
          ORDER BY p.act_start NULLS LAST, p.row_key
        ) AS prev_visit_start_latlong,
        LAG(p.attend_start_latlong) OVER (
          PARTITION BY p.user_id, p.attd_user, p.activity_day
          ORDER BY p.act_start NULLS LAST, p.row_key
        ) AS prev_attend_start_latlong,
        LAG(p.start_latlong) OVER (
          PARTITION BY p.user_id, p.attd_user, p.activity_day
          ORDER BY p.act_start NULLS LAST, p.row_key
        ) AS prev_start_latlong,
        LAG(p.customer_latlong) OVER (
          PARTITION BY p.user_id, p.attd_user, p.activity_day
          ORDER BY p.act_start NULLS LAST, p.row_key
        ) AS prev_customer_latlong
      FROM peer_base p
      WHERE p.activity_day = ANY($4::text[])
      `,
      userIds,
      dateStartBound(days[0]!),
      dateEndBound(days[days.length - 1]!),
      days
    )) as PeerRow[];

    peerByKey = new Map(peers.map((p) => [p.row_key, p]));
  }

  const rows = pageRows.map((row) => {
    const peer = peerByKey.get(row.row_key);
    return {
      ...row,
      prev_act_start: peer?.prev_act_start ?? null,
      prev_visit_start_latlong: peer?.prev_visit_start_latlong ?? null,
      prev_attend_start_latlong: peer?.prev_attend_start_latlong ?? null,
      prev_start_latlong: peer?.prev_start_latlong ?? null,
      prev_customer_latlong: peer?.prev_customer_latlong ?? null,
    };
  });

  return { total, rows };
}

export async function queryActivityReport(
  params: ActivityReportParams,
  settings: AttendanceSettings
): Promise<{ total: number; rows: ActivityReportRow[] }> {
  const resolved = (await resolveRepairFilterParams(params)) as ActivityReportParams;
  const { total, rows: rawRows } = await queryPagedActivityRaw(resolved);
  const [repairByKey, arcpByCall] = await Promise.all([
    enrichRepairDone(rawRows),
    fetchArcpFactsByCallKeys(rawRows.map((r) => r.call_no ?? '')),
  ]);
  const rows = rawRows.map((raw) =>
    mapRawToReportRow(raw, repairByKey.get(raw.row_key) ?? null, settings, arcpByCall)
  );
  return { total, rows };
}

export async function queryActivityReportExport(
  params: Omit<ActivityReportParams, 'page' | 'pageSize'>,
  settings: AttendanceSettings
): Promise<{ total: number; rows: ActivityReportRow[]; truncated: boolean }> {
  const resolved = await resolveRepairFilterParams(params);
  const { total, rows: rawRows } = await queryPagedActivityRaw({
    ...resolved,
    page: 1,
    pageSize: ACTIVITY_REPORT_EXPORT_MAX_ROWS,
  });
  const [repairByKey, arcpByCall] = await Promise.all([
    enrichRepairDone(rawRows),
    fetchArcpFactsByCallKeys(rawRows.map((r) => r.call_no ?? '')),
  ]);
  const rows = rawRows.map((raw) =>
    mapRawToReportRow(raw, repairByKey.get(raw.row_key) ?? null, settings, arcpByCall)
  );
  return { total, rows, truncated: total > rows.length };
}

type LocationDayRaw = {
  ncode: number | string;
  action_type: string | null;
  added_on: Date | string | null;
  latlong: string | null;
  distance: number | string | null;
  trn_no: string | null;
  customer_name: string | null;
  travel_mode: string | null;
  call_type: string | null;
};

/** Related = msduserlocation punches for this technician's CRM nuser on that day. */
export async function queryRelatedActivities(params: {
  userId: number;
  day: string;
  attdUser?: string | null;
}): Promise<RelatedActivityRow[]> {
  const dayStart = dateStartBound(params.day);
  const dayEnd = dateEndBound(params.day);
  const tech = params.attdUser?.trim() || '';

  // Resolve CRM nuser (numeric, may be fractional e.g. 590.3) from this tech's
  // service punches — attendance userid is a different id space.
  let locationUserId: number | null = null;
  if (tech) {
    const resolved = (await prisma.$queryRawUnsafe(
      `
      WITH tech_calls AS (
        SELECT DISTINCT
          upper(btrim(COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), '')))) AS call_no
        FROM crm_attendance_details a
        WHERE a.activity_date >= $1::timestamptz
          AND a.activity_date <= $2::timestamptz
          AND upper(btrim(COALESCE(a.attd_user, ''))) = upper(btrim($3))
          AND COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), '')) IS NOT NULL
      )
      SELECT l.user_id AS user_id, count(*)::int AS hits
      FROM crm_user_locations l
      INNER JOIN tech_calls tc
        ON tc.call_no = upper(btrim(COALESCE(l.trn_no, '')))
      WHERE l.added_on >= $1::timestamptz
        AND l.added_on <= $2::timestamptz
        AND l.user_id IS NOT NULL
        AND upper(btrim(COALESCE(l.action_type, ''))) LIKE 'SERVICE%'
      GROUP BY l.user_id
      ORDER BY count(*) DESC, l.user_id ASC
      LIMIT 1
      `,
      dayStart,
      dayEnd,
      tech
    )) as Array<{ user_id: number | string; hits: number }>;
    const uid = toNum(resolved[0]?.user_id);
    if (uid != null) locationUserId = uid;
  }
  if (locationUserId == null) {
    locationUserId = params.userId;
  }

  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT
      l.ncode,
      l.action_type,
      l.added_on,
      l.latlong,
      l.distance,
      l.trn_no,
      l.customer_name,
      l.travel_mode,
      h.call_type
    FROM crm_user_locations l
    LEFT JOIN calls_latest_hot h
      ON h.vtrnno = NULLIF(btrim(l.trn_no), '')
    WHERE l.user_id = $1::numeric
      AND l.added_on >= $2::timestamptz
      AND l.added_on <= $3::timestamptz
    ORDER BY l.added_on ASC NULLS LAST, l.ncode ASC
    `,
    locationUserId,
    dayStart,
    dayEnd
  )) as LocationDayRaw[];

  const arcpByCall = await fetchArcpFactsByCallKeys(
    rows.map((r) => r.trn_no ?? '').filter(Boolean)
  );

  const out: RelatedActivityRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const prev = i > 0 ? rows[i - 1]! : null;
    let gap: number | null = null;
    if (prev) {
      const am = toMs(prev.added_on);
      const bm = toMs(row.added_on);
      if (am != null && bm != null && bm >= am) {
        gap = Math.round(((bm - am) / 60_000) * 100) / 100;
      }
    }
    const callNo = row.trn_no?.trim() || null;
    const callKey = callNo ? callNo.toUpperCase() : '';
    const arcpDist = callKey ? (arcpByCall.get(callKey)?.distanceKm ?? null) : null;
    const action = String(row.action_type ?? '').trim() || 'Location';
    const remarksParts = [
      row.customer_name?.trim() || null,
      row.travel_mode?.trim() ? `Travel (${row.travel_mode.trim()})` : null,
    ].filter(Boolean);

    out.push({
      activity_time: row.added_on,
      activity_type: action,
      call_no: callNo,
      call_type: row.call_type,
      latlong: row.latlong,
      distance_from_prev_km: arcpDist,
      duration_gap_minutes: gap,
      remarks: remarksParts.length ? remarksParts.join(' · ') : null,
      crm_time: row.added_on,
      crm_service_total_time: null,
      time_derived: false,
    });
  }
  return out;
}

export async function queryAttendanceOfficeOptions(
  activityDateFrom: string,
  activityDateTo: string
): Promise<OfficeOption[]> {
  return (await prisma.$queryRawUnsafe(
    `
    SELECT DISTINCT
      COALESCE(office_id, -1)::bigint AS office_id,
      COALESCE(NULLIF(btrim(office_name), ''), 'Unknown') AS office_name
    FROM crm_attendance_details
    WHERE activity_date >= $1::timestamptz
      AND activity_date <= $2::timestamptz
      AND office_id IS NOT NULL
    ORDER BY office_name ASC
    `,
    dateStartBound(activityDateFrom),
    dateEndBound(activityDateTo)
  )) as OfficeOption[];
}

/** Distinct call types for current filters (no pagination, ignores callTypes). */
export async function queryActivityReportDistinctCallTypes(
  params: Omit<ActivityReportParams, 'page' | 'pageSize' | 'callTypes'>
): Promise<string[]> {
  const where = buildAttendanceWhere({ ...params, callTypes: undefined }, 3);
  const rows = await prisma.$queryRawUnsafe<Array<{ call_type: string }>>(
    `
    SELECT DISTINCT upper(btrim(h.call_type)) AS call_type
    FROM crm_attendance_details a
    ${HOT_JOIN}
    WHERE ${where.clause}
      AND NULLIF(btrim(h.call_type), '') IS NOT NULL
    ORDER BY call_type ASC
    `,
    dateStartBound(params.activityDateFrom),
    dateEndBound(params.activityDateTo),
    ...where.values
  );
  return rows.map((r) => r.call_type).filter(Boolean);
}

export type ActivityHeaderFilterField =
  | 'office'
  | 'technician'
  | 'call_no'
  | 'call_type'
  | 'serial'
  | 'repair_done';

const HEADER_FIELD_EXPR: Record<Exclude<ActivityHeaderFilterField, 'repair_done'>, string> = {
  office: `upper(btrim(a.office_name))`,
  technician: `upper(btrim(a.attd_user))`,
  call_no: `upper(btrim(COALESCE(NULLIF(btrim(a.trn_no), ''), NULLIF(btrim(a.unique_call), ''))))`,
  call_type: `upper(btrim(h.call_type))`,
  serial: `upper(btrim(h.serial))`,
};

async function queryDistinctRepairDoneValues(
  params: Omit<ActivityReportParams, 'page' | 'pageSize' | 'repairDones' | 'repairCallKeys'>
): Promise<string[]> {
  const keys = await queryMatchingCallKeys(params);
  if (!keys.length) return [];
  const names = new Set<string>();
  try {
    for (let i = 0; i < keys.length; i += REPAIR_CALL_CHUNK) {
      const chunk = keys.slice(i, i + REPAIR_CALL_CHUNK);
      const rawSql = buildDistinctRepairDoneByCallKeysSql(chunk);
      if (!rawSql) continue;
      const res = await postQuery({ rawSql, timeoutMs: 45_000 });
      for (const row of (res.data || []) as Array<Record<string, unknown>>) {
        const v = String(row.repair_done ?? '').trim();
        if (v) names.add(v);
      }
    }
  } catch {
    return [];
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Distinct header values for full matching set (no pagination). */
export async function queryActivityReportDistinctHeaderValues(
  params: Omit<ActivityReportParams, 'page' | 'pageSize'>,
  field: ActivityHeaderFilterField
): Promise<string[]> {
  if (field === 'repair_done') {
    return queryDistinctRepairDoneValues({
      searchBy: params.searchBy,
      q: params.q,
      officeIds: params.officeIds,
      callTypes: params.callTypes,
      officeNames: params.officeNames,
      technicianNames: params.technicianNames,
      callNos: params.callNos,
      serialNos: params.serialNos,
      callDateFrom: params.callDateFrom,
      callDateTo: params.callDateTo,
      activityDateFrom: params.activityDateFrom,
      activityDateTo: params.activityDateTo,
    });
  }

  const expr = HEADER_FIELD_EXPR[field];
  const whereParams: Omit<ActivityReportParams, 'page' | 'pageSize'> = {
    ...params,
    ...(field === 'office' ? { officeNames: undefined, officeIds: undefined } : {}),
    ...(field === 'technician' ? { technicianNames: undefined } : {}),
    ...(field === 'call_no' ? { callNos: undefined } : {}),
    ...(field === 'call_type' ? { callTypes: undefined } : {}),
    ...(field === 'serial' ? { serialNos: undefined } : {}),
  };
  const resolved = await resolveRepairFilterParams(whereParams);
  const where = buildAttendanceWhere(resolved, 3);
  const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    `
    SELECT DISTINCT ${expr} AS value
    FROM crm_attendance_details a
    ${HOT_JOIN}
    WHERE ${where.clause}
      AND ${expr} IS NOT NULL
      AND ${expr} <> ''
    ORDER BY value ASC
    `,
    dateStartBound(params.activityDateFrom),
    dateEndBound(params.activityDateTo),
    ...where.values
  );
  return rows.map((r) => r.value).filter(Boolean);
}

export function buildActivityReportCsv(rows: ActivityReportRow[]): string {
  const header = [
    'office',
    'technician',
    'call_no',
    'call_type',
    'serial',
    'repair_done',
    'latlong',
    'distance_km',
    'time1',
    'time2',
    'time3',
    'expense_claimed',
    'approx_repair',
    'indication',
    'activity_day',
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.office_name,
        row.technician,
        row.call_no,
        row.call_type,
        row.serial,
        row.repair_done,
        row.latlong,
        row.distance_km,
        formatDurationMinutes(row.time1_minutes),
        formatDurationMinutes(row.time2_minutes),
        formatDurationMinutes(row.time3_minutes),
        row.expense_claimed,
        formatDurationMinutes(row.approx_minutes),
        row.indication.label,
        row.activity_day,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
