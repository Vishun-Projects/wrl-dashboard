import type pg from 'pg';
import { withClient } from '@/lib/read-model/db';
import { formatLocalDate, todayIst } from '@/lib/dates/local-date';
import { currentYearStart } from '@/lib/read-model/dates';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST = 'Asia/Kolkata';

/** Resolve as-of date: MIDNIGHT_SYNC_AS_OF / AS_OF / explicit / today IST. */
export function resolveOpsSnapshotAsOf(explicit?: string | null): string {
  const raw =
    (explicit && explicit.trim()) ||
    process.env.MIDNIGHT_SYNC_AS_OF?.trim() ||
    process.env.AS_OF?.trim() ||
    todayIst();
  if (!DATE_RE.test(raw)) {
    throw new Error(`Invalid ops status snapshot as-of date: ${raw}`);
  }
  return raw;
}

function assertDate(label: string, raw: string): string {
  const v = raw.trim();
  if (!DATE_RE.test(v)) throw new Error(`Invalid ${label} date: ${raw}`);
  return v;
}

export type ActivityHotLite = {
  logged_at: Date | string | null;
  solved_at: Date | string | null;
  edited_at: Date | string | null;
  source_editedon: Date | string | null;
  status_bucket: string;
};

function istDay(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return formatLocalDate(d);
}

/**
 * Which activity buckets a hot row contributes to for calendar day `asOf` (IST).
 * Solved / tech_solved → solved_at (Register Solved Date). Cancelled → editedon.
 * Mirrors the SQL seal rules in captureOpsStatusSnapshot.
 */
export function activityFlagsForDay(
  row: ActivityHotLite,
  asOf: string
): { logged: boolean; solved: boolean; tech_solved: boolean; cancelled: boolean } {
  const solvedOn =
    istDay(row.solved_at) ?? istDay(row.edited_at) ?? istDay(row.source_editedon);
  const cancelOn =
    istDay(row.edited_at) ?? istDay(row.source_editedon) ?? istDay(row.solved_at);
  return {
    logged: istDay(row.logged_at) === asOf,
    solved: row.status_bucket === 'solved' && solvedOn === asOf,
    tech_solved: row.status_bucket === 'tech_solved' && solvedOn === asOf,
    cancelled: row.status_bucket === 'cancelled' && cancelOn === asOf,
  };
}

const CALL_TYPE_EXPR = `COALESCE(NULLIF(upper(trim(h.call_type)), ''), 'UNKNOWN')`;
/** Match Call Register "Solved Date" (dsolvedatetime → solved_at). */
const SOLVED_DAY_EXPR = `(COALESCE(h.solved_at, h.edited_at, h.source_editedon) AT TIME ZONE '${IST}')::date`;
/** Cancels use CRM editedon. */
const CANCEL_DAY_EXPR = `(COALESCE(h.edited_at, h.source_editedon, h.solved_at) AT TIME ZONE '${IST}')::date`;
const LOGGED_DAY_EXPR = `(h.logged_at AT TIME ZONE '${IST}')::date`;

/**
 * Seal daily activity for one IST calendar day from calls_latest_hot.
 * open_unallocated column = logged that day; assigned always 0.
 * Deletes prior rows for that as_of_date then inserts fresh grain
 * (office_id × call_type). Idempotent — safe to re-run the same day.
 */
export async function captureOpsStatusSnapshot(
  asOfDate?: string | null,
  client?: pg.PoolClient
): Promise<{ asOfDate: string; rows: number }> {
  const asOf = resolveOpsSnapshotAsOf(asOfDate);

  const run = async (c: pg.PoolClient) => {
    await c.query('BEGIN');
    try {
      await c.query(`DELETE FROM ops_status_snapshot_daily WHERE as_of_date = $1::date`, [asOf]);
      const inserted = await c.query(
        `
        INSERT INTO ops_status_snapshot_daily (
          as_of_date, office_id, call_type,
          open_unallocated, assigned, tech_solved, solved, cancelled, total, captured_at
        )
        SELECT
          $1::date,
          h.nofficeid,
          ${CALL_TYPE_EXPR},
          COUNT(*) FILTER (WHERE ${LOGGED_DAY_EXPR} = $1::date)::int,
          0,
          COUNT(*) FILTER (
            WHERE h.status_bucket = 'tech_solved' AND ${SOLVED_DAY_EXPR} = $1::date
          )::int,
          COUNT(*) FILTER (
            WHERE h.status_bucket = 'solved' AND ${SOLVED_DAY_EXPR} = $1::date
          )::int,
          COUNT(*) FILTER (
            WHERE h.status_bucket = 'cancelled' AND ${CANCEL_DAY_EXPR} = $1::date
          )::int,
          (
            COUNT(*) FILTER (WHERE ${LOGGED_DAY_EXPR} = $1::date)
            + COUNT(*) FILTER (
                WHERE h.status_bucket = 'tech_solved' AND ${SOLVED_DAY_EXPR} = $1::date
              )
            + COUNT(*) FILTER (
                WHERE h.status_bucket = 'solved' AND ${SOLVED_DAY_EXPR} = $1::date
              )
            + COUNT(*) FILTER (
                WHERE h.status_bucket = 'cancelled' AND ${CANCEL_DAY_EXPR} = $1::date
              )
          )::int,
          now()
        FROM calls_latest_hot h
        WHERE ${LOGGED_DAY_EXPR} = $1::date
           OR (h.status_bucket = 'tech_solved' AND ${SOLVED_DAY_EXPR} = $1::date)
           OR (h.status_bucket = 'solved' AND ${SOLVED_DAY_EXPR} = $1::date)
           OR (h.status_bucket = 'cancelled' AND ${CANCEL_DAY_EXPR} = $1::date)
        GROUP BY h.nofficeid, ${CALL_TYPE_EXPR}
        RETURNING 1
        `,
        [asOf]
      );
      await c.query('COMMIT');
      return { asOfDate: asOf, rows: inserted.rowCount ?? 0 };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  };

  if (client) return run(client);
  return withClient(run);
}

/** Earliest IST activity day still present in hot (logged / solved / cancel). */
export async function resolveOpsActivityBackfillFrom(
  client: pg.PoolClient
): Promise<string> {
  const res = await client.query<{ d: string | null }>(
    `
    SELECT MIN(d)::text AS d
    FROM (
      SELECT ${LOGGED_DAY_EXPR} AS d FROM calls_latest_hot h
      UNION ALL
      SELECT ${SOLVED_DAY_EXPR}
      FROM calls_latest_hot h
      WHERE h.status_bucket IN ('solved', 'tech_solved')
      UNION ALL
      SELECT ${CANCEL_DAY_EXPR}
      FROM calls_latest_hot h
      WHERE h.status_bucket = 'cancelled'
    ) t
    WHERE d IS NOT NULL
    `
  );
  return res.rows[0]?.d || currentYearStart();
}

/**
 * Rebuild daily activity for an inclusive IST date range from current hot.
 * Default from = earliest hot activity (so All time trend isn't stuck on YTD).
 */
export async function backfillOpsStatusActivity(
  fromDate?: string | null,
  toDate?: string | null,
  client?: pg.PoolClient
): Promise<{ fromDate: string; toDate: string; days: number; rows: number }> {
  const to = assertDate('to', toDate?.trim() || todayIst());

  const run = async (c: pg.PoolClient) => {
    const from = assertDate(
      'from',
      fromDate?.trim() || (await resolveOpsActivityBackfillFrom(c))
    );
    if (from > to) throw new Error(`Invalid range: ${from} > ${to}`);

    await c.query('BEGIN');
    try {
      await c.query(
        `DELETE FROM ops_status_snapshot_daily
         WHERE as_of_date >= $1::date AND as_of_date <= $2::date`,
        [from, to]
      );
      const inserted = await c.query(
        `
        INSERT INTO ops_status_snapshot_daily (
          as_of_date, office_id, call_type,
          open_unallocated, assigned, tech_solved, solved, cancelled, total, captured_at
        )
        SELECT
          d.as_of_date,
          d.office_id,
          d.call_type,
          d.logged,
          0,
          d.tech_solved,
          d.solved,
          d.cancelled,
          (d.logged + d.tech_solved + d.solved + d.cancelled)::int,
          now()
        FROM (
          SELECT
            e.as_of_date,
            e.office_id,
            e.call_type,
            COUNT(*) FILTER (WHERE e.kind = 'logged')::int AS logged,
            COUNT(*) FILTER (WHERE e.kind = 'tech_solved')::int AS tech_solved,
            COUNT(*) FILTER (WHERE e.kind = 'solved')::int AS solved,
            COUNT(*) FILTER (WHERE e.kind = 'cancelled')::int AS cancelled
          FROM (
            SELECT
              ${LOGGED_DAY_EXPR} AS as_of_date,
              h.nofficeid AS office_id,
              ${CALL_TYPE_EXPR} AS call_type,
              'logged'::text AS kind
            FROM calls_latest_hot h
            WHERE ${LOGGED_DAY_EXPR} >= $1::date
              AND ${LOGGED_DAY_EXPR} <= $2::date

            UNION ALL

            SELECT
              ${SOLVED_DAY_EXPR},
              h.nofficeid,
              ${CALL_TYPE_EXPR},
              'solved'
            FROM calls_latest_hot h
            WHERE h.status_bucket = 'solved'
              AND ${SOLVED_DAY_EXPR} >= $1::date
              AND ${SOLVED_DAY_EXPR} <= $2::date

            UNION ALL

            SELECT
              ${SOLVED_DAY_EXPR},
              h.nofficeid,
              ${CALL_TYPE_EXPR},
              'tech_solved'
            FROM calls_latest_hot h
            WHERE h.status_bucket = 'tech_solved'
              AND ${SOLVED_DAY_EXPR} >= $1::date
              AND ${SOLVED_DAY_EXPR} <= $2::date

            UNION ALL

            SELECT
              ${CANCEL_DAY_EXPR},
              h.nofficeid,
              ${CALL_TYPE_EXPR},
              'cancelled'
            FROM calls_latest_hot h
            WHERE h.status_bucket = 'cancelled'
              AND ${CANCEL_DAY_EXPR} >= $1::date
              AND ${CANCEL_DAY_EXPR} <= $2::date
          ) e
          WHERE e.as_of_date IS NOT NULL
          GROUP BY e.as_of_date, e.office_id, e.call_type
        ) d
        RETURNING 1
        `,
        [from, to]
      );
      await c.query('COMMIT');
      const dayCount =
        Math.round(
          (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
        ) + 1;
      return {
        fromDate: from,
        toDate: to,
        days: dayCount,
        rows: inserted.rowCount ?? 0,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    }
  };

  if (client) return run(client);
  return withClient(run);
}
