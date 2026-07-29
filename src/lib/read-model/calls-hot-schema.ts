import { withClient } from '@/lib/read-model/db';

let cachedHasBmApproval: boolean | undefined;
let cachedHasArcpBmApproved: boolean | undefined;

/** True after `11-calls_hot_bm_approval.sql` is applied. */
export async function callsHotHasBmApprovalColumns(): Promise<boolean> {
  if (cachedHasBmApproval !== undefined) return cachedHasBmApproval;
  cachedHasBmApproval = await withClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calls_latest_hot'
          AND column_name = 'bm_approved_at'
      ) AS exists
    `);
    return Boolean(result.rows[0]?.exists);
  });
  return cachedHasBmApproval;
}

/** True after `24-calls_hot_arcp_bm_approved.sql` is applied. */
export async function callsHotHasArcpBmApprovedColumn(): Promise<boolean> {
  if (cachedHasArcpBmApproved !== undefined) return cachedHasArcpBmApproved;
  cachedHasArcpBmApproved = await withClient(async (client) => {
    const result = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calls_latest_hot'
          AND column_name = 'arcp_bm_approved_at'
      ) AS exists
    `);
    return Boolean(result.rows[0]?.exists);
  });
  return cachedHasArcpBmApproved;
}

export function resetCallsHotSchemaCache(): void {
  cachedHasBmApproval = undefined;
  cachedHasArcpBmApproved = undefined;
}
