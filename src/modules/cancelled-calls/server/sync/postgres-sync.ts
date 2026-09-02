import type pg from 'pg';
import { CALLS_MIRROR_ENTITY } from '@/lib/read-model/calls-mirror/constants';

export type CancelledRegisterPostgresSyncResult = {
  source: 'mirror' | 'hot';
  upserted: number;
  deleted: number;
};

export type CancelledRegisterSourceInfo = {
  mirrorStatus: string | null;
  mirrorMaxCancelAt: Date | null;
  hotMaxCancelAt: Date | null;
  mirrorCancelledRows: number;
};

/** Prefer hot when mirror is backfilling or behind — stale mirror was blocking /report/cancelled-calls. */
export function pickCancelledRegisterSource(
  info: CancelledRegisterSourceInfo
): 'mirror' | 'hot' {
  if (info.mirrorCancelledRows <= 0) return 'hot';
  if (info.mirrorStatus !== 'ok') return 'hot';
  if (!info.mirrorMaxCancelAt) return 'hot';
  if (!info.hotMaxCancelAt) return 'mirror';
  if (info.hotMaxCancelAt.getTime() > info.mirrorMaxCancelAt.getTime()) return 'hot';
  return 'mirror';
}

const CANCELLED_WHERE = `
  COALESCE(t.ncancelreason, 0) NOT IN (0, 2)
  OR t.status_bucket = 'cancelled'
`;

function cancelAtSql(alias: string): string {
  return `COALESCE(${alias}.cancelled_at, ${alias}.edited_at, ${alias}.source_editedon, ${alias}.logged_at)`;
}

const FRANCHISEE_OFFICE_JOIN = `
  LEFT JOIN dim_offices fo ON fo.ncode = (
    CASE
      WHEN btrim(COALESCE(t.franchisee_code, '')) ~ '^[0-9]+$'
      THEN btrim(t.franchisee_code)::bigint
      ELSE NULL
    END
  )
`;

async function readSourceInfo(client: pg.PoolClient): Promise<CancelledRegisterSourceInfo> {
  const res = await client.query<{
    mirror_status: string | null;
    mirror_rows: string;
    mirror_max: Date | null;
    hot_max: Date | null;
  }>(
    `
    SELECT
      s.status AS mirror_status,
      (SELECT count(*)::text FROM calls_crm_mirror m
        WHERE COALESCE(m.ncancelreason, 0) NOT IN (0, 2)
           OR m.status_bucket = 'cancelled') AS mirror_rows,
      (SELECT max(${cancelAtSql('m')}) FROM calls_crm_mirror m
        WHERE COALESCE(m.ncancelreason, 0) NOT IN (0, 2)
           OR m.status_bucket = 'cancelled') AS mirror_max,
      (SELECT max(${cancelAtSql('h')}) FROM calls_latest_hot h
        WHERE COALESCE(h.ncancelreason, 0) NOT IN (0, 2)
           OR h.status_bucket = 'cancelled') AS hot_max
    FROM sync_state s
    WHERE s.entity = $1
    `,
    [CALLS_MIRROR_ENTITY]
  );
  const row = res.rows[0];
  return {
    mirrorStatus: row?.mirror_status ?? null,
    mirrorCancelledRows: Number(row?.mirror_rows ?? 0),
    mirrorMaxCancelAt: row?.mirror_max ?? null,
    hotMaxCancelAt: row?.hot_max ?? null,
  };
}

async function upsertFromTable(
  client: pg.PoolClient,
  table: 'calls_crm_mirror' | 'calls_latest_hot',
  since: Date | null
): Promise<number> {
  const sinceClause = since
    ? `AND ${cancelAtSql('t')} >= $1::timestamptz`
    : '';
  const params = since ? [since] : [];
  const result = await client.query(
    `
    INSERT INTO calls_cancelled (
      vtrnno, ncode, ncancelreason, cancelled_at, logged_at, call_type,
      nofficeid, office_under, party_name, branch_name, franchisee_name,
      region, account, item_name, serial, engineer_name, complaint,
      cancel_reason, item_code, franchisee_vendor_code, synced_at
    )
    SELECT
      t.vtrnno,
      t.ncode,
      COALESCE(t.ncancelreason, 0),
      ${cancelAtSql('t')},
      t.logged_at,
      t.call_type,
      t.nofficeid,
      t.office_under,
      t.party_name,
      t.branch_name,
      t.franchisee_name,
      t.region,
      t.account,
      t.item_name,
      t.serial,
      t.engineer_name,
      t.complaint,
      NULLIF(btrim(t.cancel_reason), ''),
      NULLIF(btrim(t.item_code), ''),
      NULLIF(btrim(fo.vsapvendorcode), ''),
      now()
    FROM ${table} t
    ${FRANCHISEE_OFFICE_JOIN}
    WHERE ${CANCELLED_WHERE}
      ${sinceClause}
    ON CONFLICT (vtrnno) DO UPDATE SET
      ncode = EXCLUDED.ncode,
      ncancelreason = EXCLUDED.ncancelreason,
      cancelled_at = EXCLUDED.cancelled_at,
      logged_at = EXCLUDED.logged_at,
      call_type = EXCLUDED.call_type,
      nofficeid = EXCLUDED.nofficeid,
      office_under = EXCLUDED.office_under,
      party_name = EXCLUDED.party_name,
      branch_name = EXCLUDED.branch_name,
      franchisee_name = EXCLUDED.franchisee_name,
      region = EXCLUDED.region,
      account = EXCLUDED.account,
      item_name = EXCLUDED.item_name,
      serial = EXCLUDED.serial,
      engineer_name = EXCLUDED.engineer_name,
      complaint = EXCLUDED.complaint,
      cancel_reason = EXCLUDED.cancel_reason,
      item_code = EXCLUDED.item_code,
      franchisee_vendor_code = EXCLUDED.franchisee_vendor_code,
      synced_at = now()
    `,
    params
  );
  return result.rowCount ?? 0;
}

async function pruneReopenedFromMirror(
  client: pg.PoolClient,
  since: Date | null
): Promise<number> {
  const sinceClause = since ? `AND c.cancelled_at >= $1::timestamptz` : '';
  const params = since ? [since] : [];
  const result = await client.query(
    `
    DELETE FROM calls_cancelled c
    USING calls_crm_mirror m
    WHERE c.vtrnno = m.vtrnno
      AND COALESCE(m.ncancelreason, 0) IN (0, 2)
      AND m.status_bucket IS DISTINCT FROM 'cancelled'
      ${sinceClause}
    `,
    params
  );
  return result.rowCount ?? 0;
}

export async function syncCancelledRegisterFromPostgres(
  client: pg.PoolClient,
  since: Date | null
): Promise<CancelledRegisterPostgresSyncResult> {
  const sourceInfo = await readSourceInfo(client);
  const source = pickCancelledRegisterSource(sourceInfo);

  const upserted = await upsertFromTable(
    client,
    source === 'mirror' ? 'calls_crm_mirror' : 'calls_latest_hot',
    since
  );
  const deleted =
    source === 'mirror' ? await pruneReopenedFromMirror(client, since) : 0;
  return { source, upserted, deleted };
}
