import { withAppClient } from '@/lib/read-model/db';
import {
  asOfFromPeriodYm,
  monthStartIso,
  parsePeriodYm,
} from '@/modules/warranty-provision/fy';

export type BreakdownMfgRow = {
  year: number;
  machines: number;
  majorCalls: number;
  minorCalls: number;
  /** major / (major+minor) × 100; null when no calls. */
  majorPct: number | null;
};

export type BreakdownMfgResponse = {
  periodYm: string;
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  rows: BreakdownMfgRow[];
  totalMachines: number;
  totalMajorCalls: number;
  totalMinorCalls: number;
  totalMajorPct: number | null;
};

function majorPct(major: number, minor: number): number | null {
  const n = major + minor;
  return n > 0 ? (major / n) * 100 : null;
}

function mapBreakdownRows(
  rows: Array<{
    year_key: string;
    machines: string;
    major_calls: string;
    minor_calls: string;
  }>
): BreakdownMfgRow[] {
  return rows.map((r) => {
    const majorCalls = Number(r.major_calls) || 0;
    const minorCalls = Number(r.minor_calls) || 0;
    return {
      year: Number(r.year_key) || 0,
      machines: Number(r.machines) || 0,
      majorCalls,
      minorCalls,
      majorPct: majorPct(majorCalls, minorCalls),
    };
  });
}

function summarizeBreakdown(rows: BreakdownMfgRow[]) {
  const totalMachines = rows.reduce((a, r) => a + r.machines, 0);
  const totalMajorCalls = rows.reduce((a, r) => a + r.majorCalls, 0);
  const totalMinorCalls = rows.reduce((a, r) => a + r.minorCalls, 0);
  return {
    totalMachines,
    totalMajorCalls,
    totalMinorCalls,
    totalMajorPct: majorPct(totalMajorCalls, totalMinorCalls),
  };
}

export type BreakdownMajorFilter = '' | 'major' | 'minor';

export type BreakdownMfgDetailRow = {
  serial: string;
  /** Digits at serial positions 6–7 (always present for 14-digit serials). */
  yy: string;
  trn: string;
  partyName: string;
  solvedDay: string | null;
  statusBucket: string;
  isMajor: boolean;
};

export type BreakdownMfgDetailResponse = {
  periodYm: string;
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  yearKey: string;
  /** wp-active = matched Active warranty provision; crm-w = CRM WCO=W on hot. */
  basis: 'wp-active' | 'crm-w';
  majorFilter: BreakdownMajorFilter;
  rows: BreakdownMfgDetailRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type BreakdownMfgDetailOpts = {
  page?: number;
  pageSize?: number;
  /** When true, return every matching row (Excel export). */
  all?: boolean;
};

function detailPaging(opts: BreakdownMfgDetailOpts | undefined) {
  const all = Boolean(opts?.all);
  const page = Math.max(1, opts?.page ?? 1);
  // ponytail: 100k export ceiling — raise if a year-month ever blows past it
  const pageSize = all
    ? 100_000
    : Math.min(500, Math.max(1, opts?.pageSize ?? 100));
  const offset = all ? 0 : (page - 1) * pageSize;
  return { all, page, pageSize, offset };
}

export function parseBreakdownMajorFilter(
  raw: string | null | undefined
): BreakdownMajorFilter {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'major' || s === '1' || s === 'true') return 'major';
  if (s === 'minor' || s === '0' || s === 'false') return 'minor';
  return '';
}

export type BreakdownMfgResponseWithBasis = BreakdownMfgResponse & {
  basis: 'wp-active' | 'crm-w';
};

/** Western 14-digit numeric serial (Excel MID mfg-year rule applies). */
const OUR_SERIAL = `^[0-9]{14}$`;

function yearKeyParam(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (/^\d{4}$/.test(s)) return s;
  return null;
}

/** year=ALL (or blank on export) → every mfg year for the period. */
function parseDetailYear(
  raw: string | null | undefined
): { allYears: true; yearKey: 'ALL' } | { allYears: false; yearKey: string } | null {
  const s = (raw ?? '').trim();
  if (!s || s.toUpperCase() === 'ALL') return { allYears: true, yearKey: 'ALL' };
  const yearKey = yearKeyParam(s);
  if (!yearKey) return null;
  return { allYears: false, yearKey };
}

/** Active WP row for serial as-of $2 (billing before as-of, end after as-of). */
const ACTIVE_WP_EXISTS = `
  EXISTS (
    SELECT 1
    FROM warranty_provision_rows w
    WHERE w.serial_number = c.serial
      AND w.warranty_end_date IS NOT NULL
      AND w.warranty_end_date > $2::date
      AND w.billing_date IS NOT NULL
      AND w.billing_date < $2::date
  )`;

/**
 * Distinct Active warranty machines (14-digit serials only) with Breakdown solved
 * in the selected month, grouped by mfg year = 2000 + MID(serial,6,2).
 * Calls-first: month hot set is tiny; EXISTS probes WP by serial index.
 */
export async function queryBreakdownMfgByYear(
  periodYmRaw: string
): Promise<BreakdownMfgResponseWithBasis> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      year_key: string;
      machines: string;
      major_calls: string;
      minor_calls: string;
    }>(
      `
      WITH month_calls AS (
        SELECT
          btrim(h.serial) AS serial,
          coalesce(h.is_major, false) AS is_major
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      )
      SELECT
        (2000 + (substring(c.serial FROM 6 FOR 2))::int)::text AS year_key,
        COUNT(DISTINCT c.serial)::text AS machines,
        COUNT(*) FILTER (WHERE c.is_major)::text AS major_calls,
        COUNT(*) FILTER (WHERE NOT c.is_major)::text AS minor_calls
      FROM month_calls c
      WHERE ${ACTIVE_WP_EXISTS}
      GROUP BY 1
      ORDER BY year_key
      `,
      [monthStart, asOf]
    );

    const out = mapBreakdownRows(rows);
    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      basis: 'wp-active',
      rows: out,
      ...summarizeBreakdown(out),
    } satisfies BreakdownMfgResponseWithBasis;
  });
}

/**
 * Same year-wise table from calls_latest_hot only: Breakdown solved in month,
 * 14-digit serial, CRM WCO = W. (Hot-only — do not join WP; that timed out.)
 */
export async function queryBreakdownMfgByYearCrmW(
  periodYmRaw: string
): Promise<BreakdownMfgResponseWithBasis> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      year_key: string;
      machines: string;
      major_calls: string;
      minor_calls: string;
    }>(
      `
      WITH month_calls AS (
        SELECT
          btrim(h.serial) AS serial,
          coalesce(h.is_major, false) AS is_major
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND upper(trim(coalesce(h.wco, ''))) = 'W'
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      )
      SELECT
        (2000 + (substring(serial FROM 6 FOR 2))::int)::text AS year_key,
        COUNT(DISTINCT serial)::text AS machines,
        COUNT(*) FILTER (WHERE is_major)::text AS major_calls,
        COUNT(*) FILTER (WHERE NOT is_major)::text AS minor_calls
      FROM month_calls
      GROUP BY 1
      ORDER BY year_key
      `,
      [monthStart, asOf]
    );

    const out = mapBreakdownRows(rows);
    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      basis: 'crm-w',
      rows: out,
      ...summarizeBreakdown(out),
    };
  });
}

function emptyDetail(
  periodYm: string,
  monthStart: string,
  asOf: string,
  basis: 'wp-active' | 'crm-w',
  majorFilter: BreakdownMajorFilter = '',
  page = 1,
  pageSize = 100
): BreakdownMfgDetailResponse {
  return {
    periodYm,
    monthStart,
    monthEndExclusive: asOf,
    asOf,
    yearKey: 'NA',
    basis,
    majorFilter,
    rows: [],
    total: 0,
    page,
    pageSize,
  };
}

function mapDetailRows(
  rows: {
    serial: string;
    yy: string;
    trn: string | null;
    party_name: string | null;
    solved_day: string | null;
    status_bucket: string | null;
    is_major: boolean;
  }[]
): BreakdownMfgDetailRow[] {
  return rows.map((r) => ({
    serial: r.serial,
    yy: r.yy,
    trn: r.trn ?? '',
    partyName: r.party_name ?? '',
    solvedDay: r.solved_day,
    statusBucket: r.status_bucket ?? '',
    isMajor: Boolean(r.is_major),
  }));
}

function majorSql(filter: BreakdownMajorFilter, paramIdx: number): {
  sql: string;
  values: boolean[];
} {
  if (filter === 'major') return { sql: ` AND h.is_major = $${paramIdx}`, values: [true] };
  if (filter === 'minor') return { sql: ` AND h.is_major = $${paramIdx}`, values: [false] };
  return { sql: '', values: [] };
}

/**
 * Call rows for one mfg year (or ALL years) — 14-digit Active warranty serials only.
 * Calls-first + EXISTS Active WP (avoids scanning ~all WP serials for the YY).
 */
export async function queryBreakdownMfgDetail(
  periodYmRaw: string,
  yearRaw: string,
  majorFilterRaw: string | null | undefined = '',
  opts?: BreakdownMfgDetailOpts
): Promise<BreakdownMfgDetailResponse> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const majorFilter = parseBreakdownMajorFilter(majorFilterRaw);
  const { all, page, pageSize, offset } = detailPaging(opts);
  const parsed = parseDetailYear(yearRaw);
  if (!parsed) {
    return emptyDetail(periodYm, monthStart, asOf, 'wp-active', majorFilter, page, pageSize);
  }
  const { yearKey } = parsed;
  const yy = yearKey === 'ALL' ? null : String(Number(yearKey) - 2000).padStart(2, '0');
  const majParam = yy ? 4 : 3;
  const maj = majorSql(majorFilter, majParam);
  const limIdx = majParam + maj.values.length;
  const baseValues = yy
    ? [monthStart, asOf, yy, ...maj.values]
    : [monthStart, asOf, ...maj.values];
  const yySql = yy ? ` AND substring(btrim(h.serial) FROM 6 FOR 2) = $3` : '';

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      serial: string;
      yy: string;
      trn: string | null;
      party_name: string | null;
      solved_day: string | null;
      status_bucket: string | null;
      is_major: boolean;
      total: string;
    }>(
      `
      WITH month_calls AS (
        SELECT
          btrim(h.serial) AS serial,
          substring(btrim(h.serial) FROM 6 FOR 2) AS yy,
          coalesce(h.vtrnno, '') AS trn,
          coalesce(h.party_name, '') AS party_name,
          (h.solved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS solved_day,
          h.status_bucket::text AS status_bucket,
          coalesce(h.is_major, false) AS is_major,
          h.solved_at
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          ${yySql}
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          ${maj.sql}
      ),
      matched AS (
        SELECT c.*
        FROM month_calls c
        WHERE ${ACTIVE_WP_EXISTS}
      )
      SELECT
        serial,
        yy,
        trn,
        party_name,
        solved_day,
        status_bucket,
        is_major,
        count(*) OVER()::text AS total
      FROM matched
      ORDER BY solved_at NULLS LAST, serial, trn
      LIMIT $${limIdx} OFFSET $${limIdx + 1}
      `,
      [...baseValues, pageSize, offset]
    );

    const total = Number(rows[0]?.total ?? 0) || 0;
    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      yearKey,
      basis: 'wp-active' as const,
      majorFilter,
      rows: mapDetailRows(rows),
      total,
      page: all ? 1 : page,
      pageSize: all ? total || pageSize : pageSize,
    };
  });
}

/** Call rows for one mfg year (or ALL) — CRM WCO=W Breakdown solved (hot only). */
export async function queryBreakdownMfgDetailCrmW(
  periodYmRaw: string,
  yearRaw: string,
  majorFilterRaw: string | null | undefined = '',
  opts?: BreakdownMfgDetailOpts
): Promise<BreakdownMfgDetailResponse> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const majorFilter = parseBreakdownMajorFilter(majorFilterRaw);
  const { all, page, pageSize, offset } = detailPaging(opts);
  const parsed = parseDetailYear(yearRaw);
  if (!parsed) {
    return emptyDetail(periodYm, monthStart, asOf, 'crm-w', majorFilter, page, pageSize);
  }
  const { yearKey } = parsed;
  const yy = yearKey === 'ALL' ? null : String(Number(yearKey) - 2000).padStart(2, '0');
  const majParam = yy ? 4 : 3;
  const maj = majorSql(majorFilter, majParam);
  const limIdx = majParam + maj.values.length;
  const baseValues = yy
    ? [monthStart, asOf, yy, ...maj.values]
    : [monthStart, asOf, ...maj.values];
  const yySql = yy ? ` AND substring(btrim(h.serial) FROM 6 FOR 2) = $3` : '';

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      serial: string;
      yy: string;
      trn: string | null;
      party_name: string | null;
      solved_day: string | null;
      status_bucket: string | null;
      is_major: boolean;
      total: string;
    }>(
      `
      SELECT
        btrim(h.serial) AS serial,
        substring(btrim(h.serial) FROM 6 FOR 2) AS yy,
        coalesce(h.vtrnno, '') AS trn,
        coalesce(h.party_name, '') AS party_name,
        (h.solved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS solved_day,
        h.status_bucket::text AS status_bucket,
        coalesce(h.is_major, false) AS is_major,
        count(*) OVER()::text AS total
      FROM calls_latest_hot h
      WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
        AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
        AND upper(trim(coalesce(h.wco, ''))) = 'W'
        AND btrim(h.serial) ~ '${OUR_SERIAL}'
        ${yySql}
        AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        ${maj.sql}
      ORDER BY h.solved_at NULLS LAST, serial, trn
      LIMIT $${limIdx} OFFSET $${limIdx + 1}
      `,
      [...baseValues, pageSize, offset]
    );

    const total = Number(rows[0]?.total ?? 0) || 0;
    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      yearKey,
      basis: 'crm-w',
      majorFilter,
      rows: mapDetailRows(rows),
      total,
      page: all ? 1 : page,
      pageSize: all ? total || pageSize : pageSize,
    };
  });
}

/** UI / API label for which side a mismatched call belongs to. */
export type BreakdownMismatchOnlyIn = 'Warranty Provisioning' | 'CRM';

export type BreakdownMismatchRow = {
  onlyIn: BreakdownMismatchOnlyIn;
  mfgYear: number;
  serial: string;
  trn: string;
  partyName: string;
  wco: string;
  solvedDay: string | null;
  statusBucket: string;
  warrantyEnd: string | null;
};

export type BreakdownMismatchResponse = {
  periodYm: string;
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  onlyIn: '' | 'wp' | 'crm';
  rows: BreakdownMismatchRow[];
  total: number;
  page: number;
  pageSize: number;
  wpOnlyCount: number;
  crmOnlyCount: number;
  /** Present when reading the stored mismatch table. */
  meta?: {
    periodYm: string;
    syncedAt: string | null;
    rowCount: number;
    wpOnlyCount: number;
    crmOnlyCount: number;
    syncedBy: string;
  };
};

