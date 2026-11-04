import { withAppClient } from '@/lib/read-model/db';
import {
  asOfFromPeriodYm,
  monthStartIso,
  parsePeriodYm,
} from '@/modules/warranty-provision/fy';

export type BreakdownMfgRow = {
  year: number;
  machines: number;
};

export type BreakdownMfgResponse = {
  periodYm: string;
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  rows: BreakdownMfgRow[];
  totalMachines: number;
};

export type BreakdownMfgDetailRow = {
  serial: string;
  /** Digits at serial positions 6–7 (always present for 14-digit serials). */
  yy: string;
  trn: string;
  partyName: string;
  solvedDay: string | null;
  statusBucket: string;
};

export type BreakdownMfgDetailResponse = {
  periodYm: string;
  monthStart: string;
  monthEndExclusive: string;
  asOf: string;
  yearKey: string;
  /** wp-active = matched Active warranty provision; crm-w = CRM WCO=W on hot. */
  basis: 'wp-active' | 'crm-w';
  rows: BreakdownMfgDetailRow[];
  total: number;
  truncated: boolean;
};

export type BreakdownMfgResponseWithBasis = BreakdownMfgResponse & {
  basis: 'wp-active' | 'crm-w';
};

const DETAIL_LIMIT = 2000;

/** Western 14-digit numeric serial (Excel MID mfg-year rule applies). */
const OUR_SERIAL = `^[0-9]{14}$`;

function yearKeyParam(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (/^\d{4}$/.test(s)) return s;
  return null;
}

/**
 * Distinct Active warranty machines (14-digit serials only) with Breakdown solved
 * in the selected month, grouped by mfg year = 2000 + MID(serial,6,2).
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
    }>(
      `
      WITH active AS (
        SELECT DISTINCT btrim(serial_number) AS serial
        FROM warranty_provision_rows
        WHERE btrim(serial_number) ~ '${OUR_SERIAL}'
          AND warranty_end_date IS NOT NULL
          AND warranty_end_date > $2::date
      ),
      month_bd AS (
        SELECT DISTINCT btrim(h.serial) AS serial
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      ),
      matched AS (
        SELECT m.serial
        FROM month_bd m
        INNER JOIN active a ON a.serial = m.serial
      ),
      tagged AS (
        SELECT (2000 + (substring(serial FROM 6 FOR 2))::int)::text AS year_key
        FROM matched
      )
      SELECT year_key, COUNT(*)::text AS machines
      FROM tagged
      GROUP BY 1
      ORDER BY year_key
      `,
      [monthStart, asOf]
    );

    const out: BreakdownMfgRow[] = rows.map((r) => ({
      year: Number(r.year_key) || 0,
      machines: Number(r.machines) || 0,
    }));

    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      basis: 'wp-active',
      rows: out,
      totalMachines: out.reduce((a, r) => a + r.machines, 0),
    } satisfies BreakdownMfgResponseWithBasis;
  });
}

/**
 * Same year-wise table from calls_latest_hot only: Breakdown solved in month,
 * 14-digit serial, CRM WCO = W (under warranty as of call date).
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
    }>(
      `
      WITH month_bd AS (
        SELECT DISTINCT btrim(h.serial) AS serial
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND upper(trim(coalesce(h.wco, ''))) = 'W'
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      ),
      tagged AS (
        SELECT (2000 + (substring(serial FROM 6 FOR 2))::int)::text AS year_key
        FROM month_bd
      )
      SELECT year_key, COUNT(*)::text AS machines
      FROM tagged
      GROUP BY 1
      ORDER BY year_key
      `,
      [monthStart, asOf]
    );

    const out: BreakdownMfgRow[] = rows.map((r) => ({
      year: Number(r.year_key) || 0,
      machines: Number(r.machines) || 0,
    }));

    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      basis: 'crm-w',
      rows: out,
      totalMachines: out.reduce((a, r) => a + r.machines, 0),
    };
  });
}

function emptyDetail(
  periodYm: string,
  monthStart: string,
  asOf: string,
  basis: 'wp-active' | 'crm-w'
): BreakdownMfgDetailResponse {
  return {
    periodYm,
    monthStart,
    monthEndExclusive: asOf,
    asOf,
    yearKey: 'NA',
    basis,
    rows: [],
    total: 0,
    truncated: false,
  };
}

/**
 * Call rows for one mfg year — 14-digit Active warranty serials only.
 * Plan: year-filtered WP serials → index lookup on calls_latest_hot(serial).
 */
export async function queryBreakdownMfgDetail(
  periodYmRaw: string,
  yearRaw: string
): Promise<BreakdownMfgDetailResponse> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const yearKey = yearKeyParam(yearRaw);
  if (!yearKey) return emptyDetail(periodYm, monthStart, asOf, 'wp-active');
  const yy = String(Number(yearKey) - 2000).padStart(2, '0');

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      serial: string;
      yy: string;
      trn: string | null;
      party_name: string | null;
      solved_day: string | null;
      status_bucket: string | null;
    }>(
      `
      WITH target AS (
        SELECT DISTINCT btrim(serial_number) AS serial
        FROM warranty_provision_rows
        WHERE btrim(serial_number) ~ '${OUR_SERIAL}'
          AND warranty_end_date IS NOT NULL
          AND warranty_end_date > $2::date
          AND substring(btrim(serial_number) FROM 6 FOR 2) = $3
      )
      SELECT
        t.serial,
        substring(t.serial FROM 6 FOR 2) AS yy,
        coalesce(h.vtrnno, '') AS trn,
        coalesce(h.party_name, '') AS party_name,
        (h.solved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS solved_day,
        h.status_bucket::text AS status_bucket
      FROM target t
      INNER JOIN calls_latest_hot h ON h.serial = t.serial
      WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
        AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
        AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      ORDER BY h.solved_at NULLS LAST, t.serial, trn
      LIMIT ${DETAIL_LIMIT + 1}
      `,
      [monthStart, asOf, yy]
    );

    const truncated = rows.length > DETAIL_LIMIT;
    const slice = truncated ? rows.slice(0, DETAIL_LIMIT) : rows;

    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      yearKey,
      basis: 'wp-active',
      rows: slice.map((r) => ({
        serial: r.serial,
        yy: r.yy,
        trn: r.trn ?? '',
        partyName: r.party_name ?? '',
        solvedDay: r.solved_day,
        statusBucket: r.status_bucket ?? '',
      })),
      total: slice.length,
      truncated,
    };
  });
}

/** Call rows for one mfg year — CRM WCO=W Breakdown solved (hot only). */
export async function queryBreakdownMfgDetailCrmW(
  periodYmRaw: string,
  yearRaw: string
): Promise<BreakdownMfgDetailResponse> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const yearKey = yearKeyParam(yearRaw);
  if (!yearKey) return emptyDetail(periodYm, monthStart, asOf, 'crm-w');
  const yy = String(Number(yearKey) - 2000).padStart(2, '0');

  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      serial: string;
      yy: string;
      trn: string | null;
      party_name: string | null;
      solved_day: string | null;
      status_bucket: string | null;
    }>(
      `
      SELECT
        btrim(h.serial) AS serial,
        substring(btrim(h.serial) FROM 6 FOR 2) AS yy,
        coalesce(h.vtrnno, '') AS trn,
        coalesce(h.party_name, '') AS party_name,
        (h.solved_at AT TIME ZONE 'Asia/Kolkata')::date::text AS solved_day,
        h.status_bucket::text AS status_bucket
      FROM calls_latest_hot h
      WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
        AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
        AND upper(trim(coalesce(h.wco, ''))) = 'W'
        AND btrim(h.serial) ~ '${OUR_SERIAL}'
        AND substring(btrim(h.serial) FROM 6 FOR 2) = $3
        AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      ORDER BY h.solved_at NULLS LAST, serial, trn
      LIMIT ${DETAIL_LIMIT + 1}
      `,
      [monthStart, asOf, yy]
    );

    const truncated = rows.length > DETAIL_LIMIT;
    const slice = truncated ? rows.slice(0, DETAIL_LIMIT) : rows;

    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      yearKey,
      basis: 'crm-w',
      rows: slice.map((r) => ({
        serial: r.serial,
        yy: r.yy,
        trn: r.trn ?? '',
        partyName: r.party_name ?? '',
        solvedDay: r.solved_day,
        statusBucket: r.status_bucket ?? '',
      })),
      total: slice.length,
      truncated,
    };
  });
}
