import { withTransaction } from '@/lib/read-model/db';
import { ARCP_ENTITY } from '@/lib/read-model/arcp/lock';
import { countArcpRows, truncateArcpLines } from '@/lib/read-model/arcp/upsert';

/** Wipe ARCP hot table and sync_state so backfill can start fresh from ARCP_BACKFILL_START_DATE. */
export async function resetArcpReadModel(): Promise<void> {
  await withTransaction(async (client) => {
    const before = await countArcpRows(client);
    await truncateArcpLines(client);
    await client.query(
      `
      UPDATE sync_state
      SET status = 'pending_backfill',
          is_running = false,
          last_editedon = '1970-01-01'::timestamptz,
          last_addedon = '1970-01-01'::timestamptz,
          last_run_at = NULL,
          rows_upserted_last = 0
      WHERE entity = $1
      `,
      [ARCP_ENTITY]
    );
    console.log(`[arcp-sync] Reset complete — truncated ${before} rows from arcp_lines_hot`);
    console.log('[arcp-sync] sync_state reset to pending_backfill — run: npm run sync-worker:arcp-backfill');
  });
}
