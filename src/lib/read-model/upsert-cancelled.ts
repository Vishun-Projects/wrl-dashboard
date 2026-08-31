import type pg from 'pg';
import { isRealCancelReasonCode } from '@/lib/call/status/cancel';
import { transformCrmRowToHot } from '@/lib/read-model/transform';
import type { HotRow } from '@/lib/read-model/types';

/** Row shape for calls_cancelled upsert (excl. synced_at). */
export type CancelledUpsertRow = {
  vtrnno: string;
  ncode: number;
  ncancelreason: number;
  cancelled_at: Date;
  logged_at: Date;
  call_type: string | null;
  nofficeid: number;
  office_under: number | null;
  party_name: string | null;
  branch_name: string | null;
  franchisee_name: string | null;
  region: string;
  account: string;
  item_name: string | null;
  serial: string | null;
  engineer_name: string | null;
  complaint: string | null;
};

/** Must stay aligned with docs/read-model-phase1-schema/28-calls_cancelled.sql columns (excl. synced_at). */
export const CANCELLED_COLUMNS = [
  'vtrnno',
  'ncode',
  'ncancelreason',
  'cancelled_at',
  'logged_at',
  'call_type',
  'nofficeid',
  'office_under',
  'party_name',
  'branch_name',
  'franchisee_name',
  'region',
  'account',
  'item_name',
  'serial',
  'engineer_name',
  'complaint',
] as const;

const CANCELLED_UPDATE_SET = CANCELLED_COLUMNS.filter((c) => c !== 'vtrnno')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('synced_at = now()')
  .join(', ');

export function isCancelledHotRow(
  row: Pick<HotRow, 'status_bucket' | 'ncancelreason'>
): boolean {
  return row.status_bucket === 'cancelled' || isRealCancelReasonCode(row.ncancelreason);
}

/** Last trhcalls.editedon is the cancel datetime. */
export function cancelledAtFromHot(
  row: Pick<HotRow, 'edited_at' | 'source_editedon' | 'logged_at'>
): Date {
  return row.edited_at ?? row.source_editedon ?? row.logged_at;
}

function cancelledValuesFromRow(row: CancelledUpsertRow): unknown[] {
  return [
    row.vtrnno,
    row.ncode,
    row.ncancelreason,
    row.cancelled_at,
    row.logged_at,
    row.call_type,
    row.nofficeid,
    row.office_under,
    row.party_name,
    row.branch_name,
    row.franchisee_name,
    row.region,
    row.account,
    row.item_name,
    row.serial,
    row.engineer_name,
    row.complaint,
  ];
}

function cancelledValues(row: HotRow): unknown[] {
  return [
    row.vtrnno,
    row.ncode,
    row.ncancelreason ?? 0,
    cancelledAtFromHot(row),
    row.logged_at,
    row.call_type,
    row.nofficeid,
    row.office_under,
    row.party_name,
    row.branch_name,
    row.franchisee_name,
    row.region,
    row.account,
    row.item_name,
    row.serial,
    row.engineer_name,
    row.complaint,
  ];
}

export async function upsertCancelledRows(
  client: pg.PoolClient,
  rows: CancelledUpsertRow[],
  batchSize = 100
): Promise<number> {
  if (rows.length === 0) return 0;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * CANCELLED_COLUMNS.length;
      placeholders.push(
        `(${CANCELLED_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...cancelledValuesFromRow(row));
    });
    await client.query(
      `
      INSERT INTO calls_cancelled (${CANCELLED_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (vtrnno) DO UPDATE SET ${CANCELLED_UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }
  return upserted;
}

export async function upsertCancelledFromHotRows(
  client: pg.PoolClient,
  rows: HotRow[],
  batchSize = 100
): Promise<{ upserted: number; deleted: number }> {
  if (rows.length === 0) return { upserted: 0, deleted: 0 };

  const cancelled = rows.filter(isCancelledHotRow);
  const notCancelled = rows.filter((row) => !isCancelledHotRow(row)).map((row) => row.vtrnno);

  let upserted = 0;
  for (let i = 0; i < cancelled.length; i += batchSize) {
    const batch = cancelled.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, rowIndex) => {
      const offset = rowIndex * CANCELLED_COLUMNS.length;
      placeholders.push(
        `(${CANCELLED_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...cancelledValues(row));
    });
    await client.query(
      `
      INSERT INTO calls_cancelled (${CANCELLED_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (vtrnno) DO UPDATE SET ${CANCELLED_UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }

  const deleted = await deleteCancelledByTrn(client, notCancelled);
  return { upserted, deleted };
}

export async function deleteCancelledByTrn(
  client: pg.PoolClient,
  vtrnnos: string[]
): Promise<number> {
  if (vtrnnos.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM calls_cancelled WHERE vtrnno = ANY($1::text[])`,
    [vtrnnos]
  );
  return result.rowCount ?? 0;
}

/** CRM deltas include pre-YTD cancels that never land in hot. */
export async function syncCancelledFromCrmRows(
  client: pg.PoolClient,
  rawRows: Record<string, unknown>[]
): Promise<{ upserted: number; deleted: number }> {
  const upserts: HotRow[] = [];
  const deletes: string[] = [];
  for (const row of rawRows) {
    const hot = transformCrmRowToHot(row);
    const trn = hot?.vtrnno ?? String(row.vtrnno ?? row.UniqueCallNo ?? '').trim();
    if (!trn) continue;
    if (hot && isCancelledHotRow(hot)) upserts.push(hot);
    else deletes.push(trn);
  }
  const upserted = (await upsertCancelledFromHotRows(client, upserts)).upserted;
  const deleted = await deleteCancelledByTrn(client, deletes);
  return { upserted, deleted };
}

export async function backfillCancelledFromHot(client: pg.PoolClient): Promise<number> {
  const result = await client.query(
    `
    INSERT INTO calls_cancelled (
      vtrnno, ncode, ncancelreason, cancelled_at, logged_at, call_type,
      nofficeid, office_under, party_name, branch_name, franchisee_name,
      region, account, item_name, serial, engineer_name, complaint, synced_at
    )
    SELECT
      h.vtrnno,
      h.ncode,
      COALESCE(h.ncancelreason, 0),
      COALESCE(h.edited_at, h.source_editedon, h.logged_at),
      h.logged_at,
      h.call_type,
      h.nofficeid,
      h.office_under,
      h.party_name,
      h.branch_name,
      h.franchisee_name,
      h.region,
      h.account,
      h.item_name,
      h.serial,
      h.engineer_name,
      h.complaint,
      now()
    FROM calls_latest_hot h
    WHERE COALESCE(h.ncancelreason, 0) NOT IN (0, 2)
       OR h.status_bucket = 'cancelled'
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
    `
  );
  return result.rowCount ?? 0;
}
