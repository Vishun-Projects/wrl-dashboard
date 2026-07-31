import type pg from 'pg';
import { withClient } from '@/lib/read-model/db';
import type { ArcpHotRow } from '@/modules/arcp/server/sync/transform';

const BASE_COLUMNS = [
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

const CALL_NO_COLUMN = 'call_no' as const;

async function resolveUpsertColumns(): Promise<readonly string[]> {
  const hasCallNo = await arcpLinesHotHasCallNo();
  if (!hasCallNo) return BASE_COLUMNS;
  return ['ncode', 'vucnno', CALL_NO_COLUMN, ...BASE_COLUMNS.slice(2)];
}

function rowToValues(row: ArcpHotRow, columns: readonly string[]): unknown[] {
  const byColumn: Record<string, unknown> = {
    ncode: row.ncode,
    vucnno: row.vucnno,
    call_no: row.call_no,
    calls2fault_code: row.calls2fault_code,
    nofficeid: row.nofficeid,
    office_under: row.office_under,
    call_at: row.call_at,
    solve_at: row.solve_at,
    bm_approved_at: row.bm_approved_at,
    ho_approved_at: row.ho_approved_at,
    approve_at: row.approve_at,
    claim_month_call: row.claim_month_call,
    claim_month_solve: row.claim_month_solve,
    claim_month_approve: row.claim_month_approve,
    ncalltype: row.ncalltype,
    nitemcategory: row.nitemcategory,
    nlocalupcountry: row.nlocalupcountry,
    call_type_label: row.call_type_label,
    item_category_label: row.item_category_label,
    local_upcountry_label: row.local_upcountry_label,
    is_travel: row.is_travel,
    is_major: row.is_major,
    rate: row.rate,
    amount_payable: row.amount_payable,
    branch_approved: row.branch_approved,
    ho_approved: row.ho_approved,
    is_rejected: row.is_rejected,
    source_editedon: row.source_editedon,
    added_at: row.added_at,
  };
  return columns.map((col) => byColumn[col]);
}

export async function upsertArcpRows(
  client: pg.PoolClient,
  rows: ArcpHotRow[],
  batchSize = 100
): Promise<number> {
  if (rows.length === 0) return 0;

  const columns = await resolveUpsertColumns();
  const updateSet = columns
    .filter((c) => c !== 'ncode')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat('synced_at = now()')
    .join(', ');

  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach((row, rowIndex) => {
      const rowValues = rowToValues(row, columns);
      const offset = rowIndex * columns.length;
      placeholders.push(
        `(${columns.map((_, colIndex) => `$${offset + colIndex + 1}`).join(', ')})`
      );
      values.push(...rowValues);
    });

    await client.query(
      `
      INSERT INTO arcp_lines_hot (${columns.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (ncode) DO UPDATE SET ${updateSet}
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

let cachedHasCallNo: boolean | undefined;

/** True after `docs/read-model-phase1-schema/10-arcp_call_no.sql` is applied. */
export async function arcpLinesHotHasCallNo(): Promise<boolean> {
  if (cachedHasCallNo !== undefined) return cachedHasCallNo;
  cachedHasCallNo = await withClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'arcp_lines_hot'
          AND column_name = 'call_no'
      ) AS exists
    `);
    return Boolean(result.rows[0]?.exists);
  });
  return cachedHasCallNo;
}

export function resetArcpHotSchemaCache(): void {
  cachedHasCallNo = undefined;
}
