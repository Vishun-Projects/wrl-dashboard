import { withClient } from '@/lib/read-model/db';

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
