import type pg from 'pg';
import type { ArcpHotRow } from '@/lib/read-model/arcp/types';

const COLUMNS = [
  'ncode',
  'vucnno',
  'calls2fault_code',
  'nofficeid',
  'office_under',
  'call_at',
  'solve_at',
  'bm_approved_at',
  'ho_approved_at',
  'approve_at',
  'claim_month_call',
  'claim_month_solve',
  'claim_month_approve',
  'ncalltype',
  'nitemcategory',
  'nlocalupcountry',
  'call_type_label',
  'item_category_label',
  'local_upcountry_label',
  'is_travel',
  'is_major',
  'rate',
  'amount_payable',
  'branch_approved',
  'ho_approved',
  'is_rejected',
  'source_editedon',
  'added_at',
] as const;

function rowToValues(row: ArcpHotRow): unknown[] {
  return [
    row.ncode,
    row.vucnno,
    row.calls2fault_code,
    row.nofficeid,
    row.office_under,
    row.call_at,
    row.solve_at,
    row.bm_approved_at,
    row.ho_approved_at,
    row.approve_at,
    row.claim_month_call,
    row.claim_month_solve,
    row.claim_month_approve,
    row.ncalltype,
    row.nitemcategory,
    row.nlocalupcountry,
    row.call_type_label,
    row.item_category_label,
    row.local_upcountry_label,
    row.is_travel,
    row.is_major,
    row.rate,
    row.amount_payable,
    row.branch_approved,
    row.ho_approved,
    row.is_rejected,
    row.source_editedon,
    row.added_at,
  ];
}

const UPDATE_SET = COLUMNS.filter((c) => c !== 'ncode')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('synced_at = now()')
  .join(', ');

export async function upsertArcpRows(
  client: pg.PoolClient,
  rows: ArcpHotRow[],
  batchSize = 100
): Promise<number> {
  if (rows.length === 0) return 0;

  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, rowIndex) => {
      const rowValues = rowToValues(row);
      const offset = rowIndex * COLUMNS.length;
      placeholders.push(
        `(${COLUMNS.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues);
    });

    await client.query(
      `
      INSERT INTO arcp_lines_hot (${COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (ncode) DO UPDATE SET ${UPDATE_SET}
      `,
      values
    );
    upserted += batch.length;
  }

  return upserted;
}

export async function countArcpRows(client: pg.PoolClient): Promise<number> {
  const result = await client.query(`SELECT count(*)::int AS count FROM arcp_lines_hot`);
  return result.rows[0]?.count ?? 0;
}

export async function truncateArcpLines(client: pg.PoolClient): Promise<void> {
  await client.query(`TRUNCATE arcp_lines_hot`);
}
