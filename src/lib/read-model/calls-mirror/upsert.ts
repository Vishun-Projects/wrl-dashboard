import type pg from 'pg';
import type { HotRow } from '@/lib/read-model/types';
import {
  cancelledAtFromHot,
  isCancelledHotRow,
} from '@/lib/read-model/upsert-cancelled';

const MIRROR_COLUMNS = [
  'ncode',
  'vtrnno',
  'vcclid',
  'nofficeid',
  'nengineer',
  'office_under',
  'franchisee_code',
  'party_name',
  'branch_name',
  'franchisee_name',
  'pincode',
  'city',
  'state',
  'region',
  'account',
  'item_name',
  'serial',
  'wco',
  'engineer_name',
  'call_type',
  'complaint',
  'status_label',
  'status_bucket',
  'solve_remarks',
  'contact_person',
  'phone',
  'address',
  'has_visit',
  'is_major',
  'is_part_pending',
  'branch_headcount',
  'logged_at',
  'solved_at',
  'edited_at',
  'added_at',
  'source_editedon',
  'bsolved',
  'bfastclose',
  'bapproval',
  'bm_approved_at',
  'arcp_bm_approved_at',
  'ncancelreason',
  'cancel_reason',
  'cancelled_at',
  'lat',
  'lng',
] as const;

function cancelledAtForUpsert(row: HotRow): Date | null {
  return isCancelledHotRow(row) ? cancelledAtFromHot(row) : null;
}

function mirrorRowToValues(row: HotRow): unknown[] {
  return [
    row.ncode,
    row.vtrnno,
    row.vcclid,
    row.nofficeid,
    row.nengineer,
    row.office_under,
    row.franchisee_code,
    row.party_name,
    row.branch_name,
    row.franchisee_name,
    row.pincode,
    row.city,
    row.state,
    row.region,
    row.account,
    row.item_name,
    row.serial,
    row.wco,
    row.engineer_name,
    row.call_type,
    row.complaint,
    row.status_label,
    row.status_bucket,
    row.solve_remarks,
    row.contact_person,
    row.phone,
    row.address,
    row.has_visit,
    row.is_major,
    row.is_part_pending,
    row.branch_headcount,
    row.logged_at,
    row.solved_at,
    row.edited_at,
    row.added_at,
    row.source_editedon,
    row.bsolved,
    row.bfastclose,
    row.bapproval,
    row.bm_approved_at,
    row.arcp_bm_approved_at,
    row.ncancelreason,
    row.cancel_reason,
    row.cancelled_at ?? cancelledAtForUpsert(row),
    row.lat,
    row.lng,
  ];
}

const PRESERVE_ON_NULL_UPDATE = new Set(['bapproval', 'bm_approved_at', 'arcp_bm_approved_at']);

/** Mirror always takes latest CRM cancel stamp (full history mirror, not first-cancel preserve). */
const UPDATE_SET = MIRROR_COLUMNS.filter((c) => c !== 'vtrnno')
  .map((c) => {
    if (PRESERVE_ON_NULL_UPDATE.has(c)) {
      return `${c} = COALESCE(EXCLUDED.${c}, calls_crm_mirror.${c})`;
    }
    return `${c} = EXCLUDED.${c}`;
  })
  .concat('synced_at = now()')
  .join(', ');

export async function upsertMirrorRows(
  client: pg.PoolClient,
  rows: HotRow[],
  batchSize = 100
): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, rowIndex) => {
      const rowValues = mirrorRowToValues(row);
      const offset = rowIndex * MIRROR_COLUMNS.length;
      placeholders.push(
        `(${MIRROR_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues);
    });

    await client.query(
      `
      INSERT INTO calls_crm_mirror (${MIRROR_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (vtrnno) DO UPDATE SET ${UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }

  return upserted;
}

export async function deleteMirrorRowsByTrn(
  client: pg.PoolClient,
  vtrnnos: string[]
): Promise<number> {
  if (vtrnnos.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM calls_crm_mirror WHERE vtrnno = ANY($1::text[])`,
    [vtrnnos]
  );
  return result.rowCount ?? 0;
}

export async function fetchMirrorRowsByTrn(
  client: pg.PoolClient,
  vtrnnos: string[],
  chunkSize = 2000
): Promise<HotRow[]> {
  if (vtrnnos.length === 0) return [];
  const rows: HotRow[] = [];
  for (let i = 0; i < vtrnnos.length; i += chunkSize) {
    const chunk = vtrnnos.slice(i, i + chunkSize);
    const result = await client.query(
      `SELECT * FROM calls_crm_mirror WHERE vtrnno = ANY($1::text[])`,
      [chunk]
    );
    rows.push(...(result.rows as HotRow[]));
  }
  return rows;
}

export async function countMirrorRows(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`SELECT count(*)::int AS count FROM calls_crm_mirror`);
  return result.rows[0]?.count ?? 0;
}
