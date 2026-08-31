import type pg from 'pg';
import { CALLS_MIRROR_ENTITY } from '@/lib/read-model/calls-mirror/constants';

export type CancelledRegisterPostgresSyncResult = {
  source: 'mirror' | 'hot';
  upserted: number;
  deleted: number;
};

const CANCELLED_WHERE = `
  COALESCE(t.ncancelreason, 0) NOT IN (0, 2)
  OR t.status_bucket = 'cancelled'
`;

function cancelAtSql(alias: string): string {
  return `COALESCE(${alias}.cancelled_at, ${alias}.edited_at, ${alias}.source_editedon, ${alias}.logged_at)`;
}

async function mirrorReady(client: pg.PoolClient): Promise<boolean> {
  const res = await client.query<{ status: string | null; rows: string }>(
    `
    SELECT s.status,
           (SELECT count(*)::text FROM calls_crm_mirror m
            WHERE COALESCE(m.ncancelreason, 0) NOT IN (0, 2)
               OR m.status_bucket = 'cancelled') AS rows
    FROM sync_state s
    WHERE s.entity = $1
    `,
    [CALLS_MIRROR_ENTITY]
  );
  const row = res.rows[0];
  return Number(row?.rows ?? 0) > 0;
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
      region, account, item_name, serial, engineer_name, complaint, synced_at
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
      now()
    FROM ${table} t
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
  if (await mirrorReady(client)) {
    const upserted = await upsertFromTable(client, 'calls_crm_mirror', since);
    const deleted = await pruneReopenedFromMirror(client, since);
    return { source: 'mirror', upserted, deleted };
  }

  const upserted = await upsertFromTable(client, 'calls_latest_hot', since);
  return { source: 'hot', upserted, deleted: 0 };
}
