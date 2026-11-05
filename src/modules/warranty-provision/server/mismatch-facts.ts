import { withAppClient } from '@/lib/read-model/db';
import {
  asOfFromPeriodYm,
  monthStartIso,
  parsePeriodYm,
} from '@/modules/warranty-provision/fy';
import type {
  BreakdownMismatchOnlyIn,
  BreakdownMismatchResponse,
  BreakdownMismatchRow,
} from '@/modules/warranty-provision/server/breakdown-mfg';

const OUR_SERIAL = `^[0-9]{14}$`;

function pgDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const ENSURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS warranty_breakdown_mismatch_facts (
  period_ym      text NOT NULL,
  only_in        text NOT NULL,
  mfg_year       integer NOT NULL DEFAULT 0,
  serial         text NOT NULL DEFAULT '',
  trn            text NOT NULL,
  party_name     text NOT NULL DEFAULT '',
  wco            text NOT NULL DEFAULT '',
  solved_day     date,
  status_bucket  text NOT NULL DEFAULT '',
  warranty_end   date,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_ym, only_in, trn)
);
CREATE INDEX IF NOT EXISTS idx_warranty_breakdown_mismatch_period
  ON warranty_breakdown_mismatch_facts (period_ym, only_in, mfg_year, serial, trn);
CREATE TABLE IF NOT EXISTS warranty_breakdown_mismatch_meta (
  period_ym      text PRIMARY KEY,
  synced_at      timestamptz,
  row_count      integer NOT NULL DEFAULT 0,
  wp_only_count  integer NOT NULL DEFAULT 0,
  crm_only_count integer NOT NULL DEFAULT 0,
  synced_by      text NOT NULL DEFAULT '',
  updated_at     timestamptz NOT NULL DEFAULT now()
);
`;

type PgClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

async function ensureSchema(client: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await client.query(ENSURE_SCHEMA_SQL);
}

export type MismatchFactsMeta = {
  periodYm: string;
  syncedAt: string | null;
  rowCount: number;
  wpOnlyCount: number;
  crmOnlyCount: number;
  syncedBy: string;
};

async function readMeta(client: PgClient, periodYm: string): Promise<MismatchFactsMeta> {
  const { rows } = await client.query<{
    synced_at: Date | string | null;
    row_count: number;
    wp_only_count: number;
    crm_only_count: number;
    synced_by: string;
  }>(
    `
    SELECT synced_at, row_count, wp_only_count, crm_only_count, synced_by
    FROM warranty_breakdown_mismatch_meta
    WHERE period_ym = $1
    `,
    [periodYm]
  );
  const r = rows[0];
  return {
    periodYm,
    syncedAt: r?.synced_at
      ? (pgDate(r.synced_at) ??
        (r.synced_at instanceof Date ? r.synced_at.toISOString() : String(r.synced_at)))
      : null,
    rowCount: Number(r?.row_count ?? 0) || 0,
    wpOnlyCount: Number(r?.wp_only_count ?? 0) || 0,
    crmOnlyCount: Number(r?.crm_only_count ?? 0) || 0,
    syncedBy: String(r?.synced_by ?? ''),
  };
}

/**
 * Live XOR for every month with solved breakdowns — used only by Resync.
 * Active WP is per period (warranty_end > first of next month).
 */
const RESYNC_FACTS_SQL = `
WITH month_calls AS (
  SELECT
    to_char((h.solved_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS period_ym,
    (
      date_trunc('month', (h.solved_at AT TIME ZONE 'Asia/Kolkata')::timestamp)
      + interval '1 month'
    )::date AS as_of,
    h.vtrnno AS trn,
    btrim(h.serial) AS serial,
    coalesce(h.party_name, '') AS party_name,
    coalesce(h.wco, '') AS wco,
    (h.solved_at AT TIME ZONE 'Asia/Kolkata')::date AS solved_day,
    h.status_bucket::text AS status_bucket,
    (2000 + (substring(btrim(h.serial) FROM 6 FOR 2))::int) AS mfg_year
  FROM calls_latest_hot h
  WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
    AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
    AND h.solved_at IS NOT NULL
    AND btrim(h.serial) ~ '${OUR_SERIAL}'
    AND NULLIF(btrim(h.vtrnno), '') IS NOT NULL
),
active AS (
  SELECT btrim(serial_number) AS serial,
         MAX(warranty_end_date)::date AS warranty_end,
         MIN(billing_date)::date AS min_billing
  FROM warranty_provision_rows
  WHERE btrim(serial_number) ~ '${OUR_SERIAL}'
    AND warranty_end_date IS NOT NULL
    AND billing_date IS NOT NULL
  GROUP BY 1
),
wp AS (
  SELECT c.*, a.warranty_end
  FROM month_calls c
  INNER JOIN active a
    ON a.serial = c.serial
   AND a.warranty_end > c.as_of
   AND a.min_billing < c.as_of
),
crm AS (
  SELECT c.*, NULL::date AS warranty_end
  FROM month_calls c
  WHERE upper(trim(coalesce(c.wco, ''))) = 'W'
),
diff AS (
  SELECT
    w.period_ym,
    'Warranty Provisioning'::text AS only_in,
    w.mfg_year, w.serial, w.trn, w.party_name, w.wco, w.solved_day, w.status_bucket, w.warranty_end
  FROM wp w
  WHERE NOT EXISTS (
    SELECT 1 FROM crm r WHERE r.trn = w.trn AND r.period_ym = w.period_ym
  )
  UNION ALL
  SELECT
    r.period_ym,
    'CRM'::text AS only_in,
    r.mfg_year, r.serial, r.trn, r.party_name, r.wco, r.solved_day, r.status_bucket, r.warranty_end
  FROM crm r
  WHERE NOT EXISTS (
    SELECT 1 FROM wp w WHERE w.trn = r.trn AND w.period_ym = r.period_ym
  )
)
INSERT INTO warranty_breakdown_mismatch_facts (
  period_ym, only_in, mfg_year, serial, trn, party_name, wco,
  solved_day, status_bucket, warranty_end, synced_at
)
SELECT
  period_ym, only_in, mfg_year, serial, trn, party_name, wco,
  solved_day, status_bucket, warranty_end, now()
FROM diff
`;

/** Mark every month that had solved breakdowns — including 0-mismatch months. */
const RESYNC_META_SQL = `
WITH months AS (
  SELECT DISTINCT to_char((h.solved_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS period_ym
  FROM calls_latest_hot h
  WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
    AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
    AND h.solved_at IS NOT NULL
    AND btrim(h.serial) ~ '${OUR_SERIAL}'
    AND NULLIF(btrim(h.vtrnno), '') IS NOT NULL
),
counts AS (
  SELECT
    period_ym,
    count(*)::int AS row_count,
    count(*) FILTER (WHERE only_in = 'Warranty Provisioning')::int AS wp_only_count,
    count(*) FILTER (WHERE only_in = 'CRM')::int AS crm_only_count
  FROM warranty_breakdown_mismatch_facts
  GROUP BY period_ym
)
INSERT INTO warranty_breakdown_mismatch_meta (
  period_ym, synced_at, row_count, wp_only_count, crm_only_count, synced_by, updated_at
)
SELECT
  m.period_ym,
  now(),
  coalesce(c.row_count, 0),
  coalesce(c.wp_only_count, 0),
  coalesce(c.crm_only_count, 0),
  $1::text,
  now()
FROM months m
LEFT JOIN counts c ON c.period_ym = m.period_ym
`;

export type MismatchResyncSummary = MismatchFactsMeta & {
  periods: number;
  totalRows: number;
};

/** Rebuild mismatch facts for every month that has solved breakdowns. */
export async function resyncMismatchFacts(opts: {
  syncedBy: string;
  /** Period whose meta is returned for the UI (default: latest synced). */
  periodYm?: string;
}): Promise<MismatchResyncSummary> {
  const focusYm = opts.periodYm ? parsePeriodYm(opts.periodYm) : '';

  return withAppClient(
    async (client) => {
      await ensureSchema(client);
      await client.query('BEGIN');
      try {
        await client.query('TRUNCATE warranty_breakdown_mismatch_facts');
        await client.query(RESYNC_FACTS_SQL);
        await client.query('TRUNCATE warranty_breakdown_mismatch_meta');
        await client.query(RESYNC_META_SQL, [opts.syncedBy]);
        const summary = await client.query<{
          periods: string;
          total_rows: string;
        }>(
          `
          SELECT
            count(*)::text AS periods,
            coalesce(sum(row_count), 0)::text AS total_rows
          FROM warranty_breakdown_mismatch_meta
          `
        );
        const periods = Number(summary.rows[0]?.periods ?? 0) || 0;
        const totalRows = Number(summary.rows[0]?.total_rows ?? 0) || 0;
        const focus =
          focusYm ||
          (
            await client.query<{ period_ym: string }>(
              `
              SELECT period_ym
              FROM warranty_breakdown_mismatch_meta
              ORDER BY period_ym DESC
              LIMIT 1
              `
            )
          ).rows[0]?.period_ym ||
          '';
        await client.query('COMMIT');
        const meta = focus
          ? await readMeta(client, focus)
          : {
              periodYm: '',
              syncedAt: null,
              rowCount: 0,
              wpOnlyCount: 0,
              crmOnlyCount: 0,
              syncedBy: opts.syncedBy,
            };
        return { ...meta, periods, totalRows };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: 600_000 }
  );
}

function mapRow(r: Record<string, unknown>): BreakdownMismatchRow {
  const onlyRaw = String(r.only_in ?? '');
  const onlyIn: BreakdownMismatchOnlyIn =
    onlyRaw === 'CRM' ? 'CRM' : 'Warranty Provisioning';
  return {
    onlyIn,
    mfgYear: Number(r.mfg_year) || 0,
    serial: String(r.serial ?? ''),
    trn: String(r.trn ?? ''),
    partyName: String(r.party_name ?? ''),
    wco: String(r.wco ?? ''),
    solvedDay: pgDate(r.solved_day),
    statusBucket: String(r.status_bucket ?? ''),
    warrantyEnd: pgDate(r.warranty_end),
  };
}

/** Fast read from stored mismatch facts (populated by Resync). */
export async function listMismatchFacts(opts: {
  periodYm: string;
  onlyIn?: '' | 'wp' | 'crm';
  page?: number;
  pageSize?: number;
  /** When true, return every matching row (for Excel export). */
  all?: boolean;
}): Promise<BreakdownMismatchResponse & { meta: MismatchFactsMeta }> {
  const periodYm = parsePeriodYm(opts.periodYm);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const onlyIn = opts.onlyIn === 'wp' || opts.onlyIn === 'crm' ? opts.onlyIn : '';
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.all
    ? 100_000
    : Math.min(500, Math.max(1, opts.pageSize ?? 100));
  const offset = opts.all ? 0 : (page - 1) * pageSize;

  return withAppClient(async (client) => {
    await ensureSchema(client);
    const meta = await readMeta(client, periodYm);

    const values: unknown[] = [periodYm];
    let where = `period_ym = $1`;
    if (onlyIn === 'wp') {
      where += ` AND only_in = 'Warranty Provisioning'`;
    } else if (onlyIn === 'crm') {
      where += ` AND only_in = 'CRM'`;
    }

    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM warranty_breakdown_mismatch_facts WHERE ${where}`,
      values
    );
    const lim = values.length + 1;
    const { rows } = await client.query(
      `
      SELECT *
      FROM warranty_breakdown_mismatch_facts
      WHERE ${where}
      ORDER BY only_in, mfg_year, serial, trn
      LIMIT $${lim} OFFSET $${lim + 1}
      `,
      [...values, pageSize, offset]
    );

    return {
      periodYm,
      monthStart,
      monthEndExclusive: asOf,
      asOf,
      onlyIn,
      rows: rows.map((r) => mapRow(r as Record<string, unknown>)),
      total: Number(count.rows[0]?.n ?? 0) || 0,
      page: opts.all ? 1 : page,
      pageSize: opts.all ? Number(count.rows[0]?.n ?? 0) || pageSize : pageSize,
      wpOnlyCount: meta.wpOnlyCount,
      crmOnlyCount: meta.crmOnlyCount,
      meta,
    };
  });
}
