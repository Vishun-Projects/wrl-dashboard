import { withAppClient } from '@/lib/read-model/db';
import {
  asOfFromPeriodYm,
  monthStartIso,
  parsePeriodYm,
} from '@/modules/warranty-provision/fy';
import type { WarrantyClaimRow } from '@/modules/warranty-provision/types';

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

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? n : 0;
}

/** Total = repair + travel + spares (labour excluded). */
export function claimTotalCost(opts: {
  repairCost: number | null;
  travelingReimbursement: number | null;
  sparePartsCost: number | null;
}): number {
  return (
    money(opts.repairCost) +
    money(opts.travelingReimbursement) +
    money(opts.sparePartsCost)
  );
}

function mapFact(r: Record<string, unknown>): WarrantyClaimRow {
  const repairCost = num(r.repair_cost);
  const travelingReimbursement = num(r.traveling_reimbursement ?? r.travel_cost);
  const sparePartsCost = num(r.spare_parts_cost ?? r.spare_cost);
  return {
    id: Number(r.ncode) || 0,
    claimNo: String(r.claim_no ?? r.vtrnno ?? ''),
    serialNumber: String(r.serial_number ?? r.serial ?? ''),
    claimDate: pgDate(r.claim_date),
    defectDescription: String(r.defect_description ?? r.defect ?? ''),
    repairCost,
    sparePartsCost,
    labourCost: null,
    travelingReimbursement,
    totalCost:
      num(r.total_cost) ??
      claimTotalCost({ repairCost, travelingReimbursement, sparePartsCost }),
    unitId: r.unit_id == null ? null : Number(r.unit_id),
    matchStatus: String(r.match_status ?? 'unmatched'),
  };
}

const ENSURE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS warranty_claim_facts (
  claim_no                  text PRIMARY KEY,
  ncode                     bigint NOT NULL DEFAULT 0,
  serial_number             text NOT NULL DEFAULT '',
  claim_date                date,
  defect_description        text NOT NULL DEFAULT '',
  repair_cost               numeric(14,2) NOT NULL DEFAULT 0,
  traveling_reimbursement   numeric(14,2) NOT NULL DEFAULT 0,
  spare_parts_cost          numeric(14,2) NOT NULL DEFAULT 0,
  total_cost                numeric(14,2) NOT NULL DEFAULT 0,
  unit_id                   bigint,
  match_status              text NOT NULL DEFAULT 'unmatched',
  material_group            text NOT NULL DEFAULT '',
  warranty_start            date,
  warranty_end_date         date,
  synced_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_date
  ON warranty_claim_facts (claim_date DESC NULLS LAST, ncode DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_serial
  ON warranty_claim_facts (serial_number);
CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_match
  ON warranty_claim_facts (match_status);
CREATE TABLE IF NOT EXISTS warranty_claim_facts_meta (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced_at   timestamptz,
  row_count   integer NOT NULL DEFAULT 0,
  synced_by   text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO warranty_claim_facts_meta (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
`;

async function ensureSchema(client: {
  query: (sql: string) => Promise<unknown>;
}): Promise<void> {
  await client.query(ENSURE_SCHEMA_SQL);
}

const LATEST_MB51 = `(SELECT id FROM mb51_aging_imports ORDER BY imported_at DESC LIMIT 1)`;

/** Live join used only by Resync — not by normal Claims reads. */
const RESYNC_INSERT_SQL = `
TRUNCATE warranty_claim_facts;
INSERT INTO warranty_claim_facts (
  claim_no, ncode, serial_number, claim_date, defect_description,
  repair_cost, traveling_reimbursement, spare_parts_cost, total_cost,
  unit_id, match_status, material_group, warranty_start, warranty_end_date, synced_at
)
WITH units AS (
  SELECT DISTINCT ON (serial_number)
    id, serial_number, warranty_start, warranty_end_date, material_group
  FROM warranty_provision_rows
  WHERE btrim(serial_number) <> ''
  ORDER BY serial_number, id
),
base_calls AS (
  SELECT
    h.ncode,
    h.vtrnno,
    h.serial,
    (h.logged_at AT TIME ZONE 'Asia/Kolkata')::date AS claim_date,
    u.id AS unit_id,
    u.warranty_start,
    u.warranty_end_date,
    u.material_group
  FROM calls_latest_hot h
  INNER JOIN units u ON u.serial_number = h.serial
  WHERE NULLIF(btrim(h.vtrnno), '') IS NOT NULL
),
call_keys AS (
  SELECT DISTINCT upper(btrim(vtrnno)) AS call_key FROM base_calls
),
arcp AS (
  SELECT
    upper(btrim(a.vucnno)) AS call_key,
    COALESCE(SUM(a.amount_payable) FILTER (WHERE NOT a.is_travel), 0) AS repair_cost,
    COALESCE(SUM(a.amount_payable) FILTER (WHERE a.is_travel), 0) AS travel_cost,
    string_agg(DISTINCT NULLIF(btrim(a.repair_label), ''), '; ') AS defect
  FROM arcp_lines_hot a
  INNER JOIN call_keys k ON k.call_key = upper(btrim(a.vucnno))
  WHERE NOT a.is_rejected
  GROUP BY 1
),
spares AS (
  SELECT
    upper(btrim(r.item_text)) AS call_key,
    COALESCE(SUM(ABS(r.amt_in_loc_cur)), 0) AS spare_cost
  FROM mb51_aging_rows r
  INNER JOIN call_keys k ON k.call_key = upper(btrim(r.item_text))
  WHERE r.import_id = ${LATEST_MB51}
    AND r.amt_in_loc_cur IS NOT NULL
  GROUP BY 1
)
SELECT
  b.vtrnno,
  b.ncode,
  b.serial,
  b.claim_date,
  COALESCE(arcp.defect, ''),
  COALESCE(arcp.repair_cost, 0),
  COALESCE(arcp.travel_cost, 0),
  COALESCE(spares.spare_cost, 0),
  COALESCE(arcp.repair_cost, 0) + COALESCE(arcp.travel_cost, 0) + COALESCE(spares.spare_cost, 0),
  b.unit_id,
  CASE
    WHEN b.unit_id IS NULL THEN 'unmatched'
    WHEN b.claim_date IS NOT NULL
      AND b.warranty_start IS NOT NULL
      AND b.warranty_end_date IS NOT NULL
      AND (b.claim_date < b.warranty_start OR b.claim_date > b.warranty_end_date)
      THEN 'outside_warranty'
    ELSE 'matched'
  END,
  COALESCE(b.material_group, ''),
  b.warranty_start,
  b.warranty_end_date,
  now()
FROM base_calls b
LEFT JOIN arcp ON arcp.call_key = upper(btrim(b.vtrnno))
LEFT JOIN spares ON spares.call_key = upper(btrim(b.vtrnno))
WHERE COALESCE(arcp.repair_cost, 0) <> 0
   OR COALESCE(arcp.travel_cost, 0) <> 0
   OR COALESCE(spares.spare_cost, 0) <> 0
`;

export type ClaimFactsMeta = {
  syncedAt: string | null;
  rowCount: number;
  syncedBy: string;
};

type PgClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

async function readMeta(client: PgClient): Promise<ClaimFactsMeta> {
  const { rows } = await client.query<{
    synced_at: Date | string | null;
    row_count: number;
    synced_by: string;
  }>(`SELECT synced_at, row_count, synced_by FROM warranty_claim_facts_meta WHERE id = 1`);
  const r = rows[0];
  return {
    syncedAt: r?.synced_at
      ? (pgDate(r.synced_at) ??
        (r.synced_at instanceof Date ? r.synced_at.toISOString() : String(r.synced_at)))
      : null,
    rowCount: Number(r?.row_count ?? 0) || 0,
    syncedBy: String(r?.synced_by ?? ''),
  };
}

export async function getClaimFactsMeta(): Promise<ClaimFactsMeta> {
  return withAppClient(async (client) => {
    await ensureSchema(client);
    return readMeta(client);
  });
}

export async function resyncClaimFacts(opts: {
  syncedBy: string;
}): Promise<ClaimFactsMeta> {
  return withAppClient(
    async (client) => {
      await ensureSchema(client);
      await client.query('BEGIN');
      try {
        await client.query(RESYNC_INSERT_SQL);
        const count = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM warranty_claim_facts`
        );
        const rowCount = Number(count.rows[0]?.n ?? 0) || 0;
        await client.query(
          `
          INSERT INTO warranty_claim_facts_meta (id, synced_at, row_count, synced_by, updated_at)
          VALUES (1, now(), $1, $2, now())
          ON CONFLICT (id) DO UPDATE SET
            synced_at = EXCLUDED.synced_at,
            row_count = EXCLUDED.row_count,
            synced_by = EXCLUDED.synced_by,
            updated_at = now()
          `,
          [rowCount, opts.syncedBy]
        );
        await client.query('COMMIT');
        return readMeta(client);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
    { statementTimeoutMs: 600_000 }
  );
}

export async function listClaimFacts(opts: {
  periodYm: string;
  page: number;
  pageSize: number;
  q: string;
}): Promise<{ rows: WarrantyClaimRow[]; total: number; meta: ClaimFactsMeta }> {
  const periodYm = parsePeriodYm(opts.periodYm);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const q = opts.q.trim();

  return withAppClient(async (client) => {
    await ensureSchema(client);
    const meta = await readMeta(client);

    const values: unknown[] = [monthStart, asOf];
    let where = `claim_date >= $1::date AND claim_date < $2::date`;
    if (q) {
      const exact = !/[\\%]/.test(q) ? q.toUpperCase() : null;
      if (exact) {
        values.push(exact, `%${q}%`);
        where += `
          AND (
            upper(btrim(claim_no)) = $3
            OR upper(btrim(serial_number)) = $3
            OR claim_no ILIKE $4
            OR serial_number ILIKE $4
          )
        `;
      } else {
        values.push(`%${q}%`);
        where += ` AND (claim_no ILIKE $3 OR serial_number ILIKE $3)`;
      }
    }

    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM warranty_claim_facts WHERE ${where}`,
      values
    );
    const lim = values.length + 1;
    const { rows } = await client.query(
      `
      SELECT *
      FROM warranty_claim_facts
      WHERE ${where}
      ORDER BY claim_date DESC NULLS LAST, ncode DESC
      LIMIT $${lim} OFFSET $${lim + 1}
      `,
      [...values, opts.pageSize, (opts.page - 1) * opts.pageSize]
    );

    return {
      rows: rows.map((r) => mapFact(r as Record<string, unknown>)),
      total: Number(count.rows[0]?.n ?? 0) || 0,
      meta,
    };
  });
}

export type ClaimsByMgBasis = 'wp-active' | 'crm-w';

export type ClaimsByMaterialDefectRow = {
  materialGroup: string;
  uniqueUnits: number;
  callCount: number;
  majorCalls: number;
  minorCalls: number;
  repairCost: number;
  travelingReimbursement: number;
  sparePartsCost: number;
  totalCost: number;
};

export type ClaimsByMaterialDefectResponse = {
  periodYm: string;
  monthStart: string;
  asOf: string;
  basis: ClaimsByMgBasis;
  rows: ClaimsByMaterialDefectRow[];
  totals: {
    uniqueUnits: number;
    callCount: number;
    majorCalls: number;
    minorCalls: number;
    repairCost: number;
    travelingReimbursement: number;
    sparePartsCost: number;
    totalCost: number;
  };
};

const OUR_SERIAL = `^[0-9]{14}$`;

export function parseClaimsByMgBasis(
  raw: string | null | undefined
): ClaimsByMgBasis {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'crm-w' || s === 'crm' || s === 'wco') return 'crm-w';
  return 'wp-active';
}

/**
 * SNAP under-panel: same Breakdown call set as the year tables, costs/MG from claim facts.
 * basis=wp-active → Active WP match; basis=crm-w → hot WCO=W.
 */
export async function queryClaimsByMaterialDefect(
  periodYmRaw: string,
  basisRaw: string | null | undefined = 'wp-active'
): Promise<ClaimsByMaterialDefectResponse> {
  const periodYm = parsePeriodYm(periodYmRaw);
  const monthStart = monthStartIso(periodYm);
  const asOf = asOfFromPeriodYm(periodYm);
  const basis = parseClaimsByMgBasis(basisRaw);

  const callsCte =
    basis === 'crm-w'
      ? `
      month_calls AS (
        SELECT
          h.vtrnno AS trn,
          btrim(h.serial) AS serial,
          coalesce(h.is_major, false) AS is_major
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND upper(trim(coalesce(h.wco, ''))) = 'W'
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      )`
      : `
      month_calls AS (
        SELECT
          h.vtrnno AS trn,
          btrim(h.serial) AS serial,
          coalesce(h.is_major, false) AS is_major
        FROM calls_latest_hot h
        WHERE upper(trim(coalesce(h.call_type, ''))) = 'BREAKDOWN'
          AND h.status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type)
          AND btrim(h.serial) ~ '${OUR_SERIAL}'
          AND h.solved_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND h.solved_at < ($2::date::timestamp AT TIME ZONE 'Asia/Kolkata')
      ),
      matched AS (
        SELECT c.trn, c.serial, c.is_major
        FROM month_calls c
        WHERE EXISTS (
          SELECT 1
          FROM warranty_provision_rows w
          WHERE w.serial_number = c.serial
            AND w.warranty_end_date IS NOT NULL
            AND w.warranty_end_date > $2::date
            AND w.billing_date IS NOT NULL
            AND w.billing_date < $2::date
        )
      )`;

  const fromAlias = basis === 'crm-w' ? 'month_calls' : 'matched';

  return withAppClient(async (client) => {
    await ensureSchema(client);
    const { rows } = await client.query<{
      material_group: string;
      unique_units: string;
      call_count: string;
      major_calls: string;
      minor_calls: string;
      repair_cost: string;
      traveling_reimbursement: string;
      spare_parts_cost: string;
      total_cost: string;
    }>(
      `
      WITH ${callsCte}
      SELECT
        COALESCE(
          NULLIF(btrim(f.material_group), ''),
          NULLIF(btrim(w.material_group), ''),
          '(blank)'
        ) AS material_group,
        COUNT(DISTINCT c.serial)::text AS unique_units,
        COUNT(*)::text AS call_count,
        COUNT(*) FILTER (WHERE c.is_major)::text AS major_calls,
        COUNT(*) FILTER (WHERE NOT c.is_major)::text AS minor_calls,
        COALESCE(SUM(f.repair_cost), 0)::text AS repair_cost,
        COALESCE(SUM(f.traveling_reimbursement), 0)::text AS traveling_reimbursement,
        COALESCE(SUM(f.spare_parts_cost), 0)::text AS spare_parts_cost,
        COALESCE(SUM(f.total_cost), 0)::text AS total_cost
      FROM ${fromAlias} c
      LEFT JOIN warranty_claim_facts f ON f.claim_no = c.trn
      LEFT JOIN LATERAL (
        SELECT material_group
        FROM warranty_provision_rows w
        WHERE w.serial_number = c.serial
        ORDER BY w.id
        LIMIT 1
      ) w ON true
      GROUP BY 1
      ORDER BY 1
      `,
      [monthStart, asOf]
    );

    const out: ClaimsByMaterialDefectRow[] = rows.map((r) => ({
      materialGroup: r.material_group,
      uniqueUnits: Number(r.unique_units) || 0,
      callCount: Number(r.call_count) || 0,
      majorCalls: Number(r.major_calls) || 0,
      minorCalls: Number(r.minor_calls) || 0,
      repairCost: Number(r.repair_cost) || 0,
      travelingReimbursement: Number(r.traveling_reimbursement) || 0,
      sparePartsCost: Number(r.spare_parts_cost) || 0,
      totalCost: Number(r.total_cost) || 0,
    }));

    const totals = {
      uniqueUnits: out.reduce((a, r) => a + r.uniqueUnits, 0),
      callCount: out.reduce((a, r) => a + r.callCount, 0),
      majorCalls: out.reduce((a, r) => a + r.majorCalls, 0),
      minorCalls: out.reduce((a, r) => a + r.minorCalls, 0),
      repairCost: out.reduce((a, r) => a + r.repairCost, 0),
      travelingReimbursement: out.reduce((a, r) => a + r.travelingReimbursement, 0),
      sparePartsCost: out.reduce((a, r) => a + r.sparePartsCost, 0),
      totalCost: out.reduce((a, r) => a + r.totalCost, 0),
    };

    // Unique units can overlap material groups if a serial has multiple MGs (shouldn't);
    // recompute distinct across the call set so footer matches Breakdown Machines.
    const uniq = await client.query<{ n: string }>(
      `
      WITH ${callsCte}
      SELECT COUNT(DISTINCT c.serial)::text AS n FROM ${fromAlias} c
      `,
      [monthStart, asOf]
    );
    totals.uniqueUnits = Number(uniq.rows[0]?.n ?? 0) || 0;

    return { periodYm, monthStart, asOf, basis, rows: out, totals };
  });
}

export async function claimFactRateStats(asOf: string): Promise<{
  totalClaims: number;
  matchedClaims: number;
  avgClaimCost: number | null;
  byMaterialGroup: Array<{
    materialGroup: string;
    claims: number;
    avgCost: number | null;
  }>;
  byAgeBand: Array<{ band: string; claims: number }>;
}> {
  return withAppClient(async (client) => {
    await ensureSchema(client);
    const { rows } = await client.query<{
      total_claims: string;
      matched: string;
      avg_cost: string | null;
      by_group: unknown;
      by_age: unknown;
    }>(
      `
      WITH facts AS (
        SELECT *
        FROM warranty_claim_facts
        WHERE claim_date IS NULL OR claim_date < $1::date
      ),
      matched AS (
        SELECT * FROM facts WHERE match_status = 'matched'
      )
      SELECT
        (SELECT count(*)::text FROM facts) AS total_claims,
        (SELECT count(*)::text FROM matched) AS matched,
        (SELECT AVG(total_cost)::text FROM facts) AS avg_cost,
        (
          SELECT coalesce(json_agg(row_to_json(g) ORDER BY g.claims DESC), '[]'::json)
          FROM (
            SELECT
              COALESCE(NULLIF(btrim(material_group), ''), '(blank)') AS "materialGroup",
              count(*)::int AS claims,
              AVG(total_cost) AS "avgCost"
            FROM matched
            GROUP BY 1
          ) g
        ) AS by_group,
        (
          SELECT coalesce(json_agg(row_to_json(a)), '[]'::json)
          FROM (
            SELECT
              CASE
                WHEN warranty_start IS NULL OR claim_date IS NULL THEN 'unknown'
                WHEN (claim_date - warranty_start) < 180 THEN '0-6m'
                WHEN (claim_date - warranty_start) < 365 THEN '6-12m'
                WHEN (claim_date - warranty_start) < 730 THEN '12-24m'
                WHEN (claim_date - warranty_start) < 1095 THEN '24-36m'
                ELSE '36m+'
              END AS band,
              count(*)::int AS claims
            FROM matched
            GROUP BY 1
          ) a
        ) AS by_age
      `,
      [asOf]
    );

    const row = rows[0];
    const byGroup = (Array.isArray(row?.by_group) ? row.by_group : []) as Array<{
      materialGroup: string;
      claims: number;
      avgCost: number | null;
    }>;
    const byAge = (Array.isArray(row?.by_age) ? row.by_age : []) as Array<{
      band: string;
      claims: number;
    }>;

    return {
      totalClaims: Number(row?.total_claims ?? 0) || 0,
      matchedClaims: Number(row?.matched ?? 0) || 0,
      avgClaimCost: row?.avg_cost != null ? Number(row.avg_cost) : null,
      byMaterialGroup: byGroup.map((g) => ({
        materialGroup: String(g.materialGroup ?? ''),
        claims: Number(g.claims) || 0,
        avgCost: g.avgCost != null ? Number(g.avgCost) : null,
      })),
      byAgeBand: byAge.map((a) => ({
        band: String(a.band ?? ''),
        claims: Number(a.claims) || 0,
      })),
    };
  });
}
