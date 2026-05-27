import type pg from 'pg';
import type { HotRow } from '@/lib/read-model/types';

const HOT_COLUMNS = [
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
  'ncancelreason',
  'lat',
  'lng',
] as const;

function hotRowToValues(row: HotRow): unknown[] {
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
    row.ncancelreason,
    row.lat,
    row.lng,
  ];
}

const UPDATE_SET = HOT_COLUMNS.filter((c) => c !== 'vtrnno')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('synced_at = now()')
  .join(', ');

export async function upsertHotRows(
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
      const rowValues = hotRowToValues(row);
      const offset = rowIndex * HOT_COLUMNS.length;
      placeholders.push(
        `(${HOT_COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues);
    });

    await client.query(
      `
      INSERT INTO calls_latest_hot (${HOT_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (vtrnno) DO UPDATE SET ${UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }

  return upserted;
}

export async function deleteHotRowsByTrn(
  client: pg.PoolClient,
  vtrnnos: string[]
): Promise<number> {
  if (vtrnnos.length === 0) return 0;
  const result = await client.query(
    `DELETE FROM calls_latest_hot WHERE vtrnno = ANY($1::text[])`,
    [vtrnnos]
  );
  return result.rowCount ?? 0;
}

export async function fetchHotRowsByTrn(
  client: pg.PoolClient,
  vtrnnos: string[]
): Promise<HotRow[]> {
  if (vtrnnos.length === 0) return [];
  const result = await client.query(`SELECT * FROM calls_latest_hot WHERE vtrnno = ANY($1::text[])`, [
    vtrnnos,
  ]);
  return result.rows as HotRow[];
}

export async function countHotRows(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`SELECT count(*)::int AS count FROM calls_latest_hot`);
  return result.rows[0]?.count ?? 0;
}

export async function truncateHot(client: pg.PoolClient): Promise<void> {
  await client.query(`TRUNCATE calls_latest_hot`);
}
