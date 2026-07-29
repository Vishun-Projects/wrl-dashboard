import { withClient } from '@/lib/read-model/db';
import { callsHotHasArcpBmApprovedColumn } from '@/lib/read-model/calls-hot-schema';

/**
 * Backfill calls_latest_hot.arcp_bm_approved_at from arcp_lines_hot.
 * Uses the same ARCP pick precedence as the register enrichment:
 *   1. Match by vucnno (Service Order) — preferred
 *   2. Fallback by call_no (legacy, only when vucnno is blank on the ARCP line)
 */
export async function runBackfillArcpBmApproved(opts?: {
  onlyMissing?: boolean;
}): Promise<{ ok: boolean; reason?: string; rowsUpdated: number }> {
  if (!(await callsHotHasArcpBmApprovedColumn())) {
    return {
      ok: false,
      reason: 'Run docs/read-model-phase1-schema/24-calls_hot_arcp_bm_approved.sql first',
      rowsUpdated: 0,
    };
  }

  const onlyMissing = opts?.onlyMissing !== false;

  return withClient(async (client) => {
    const missingClause = onlyMissing
      ? 'AND h.arcp_bm_approved_at IS NULL'
      : '';

    // Single UPDATE using the same DISTINCT ON pick logic as arcp-approve-dates-server.ts
    const result = await client.query(`
      WITH arcp_pick AS (
        SELECT DISTINCT ON (upper(trim(vucnno)))
          upper(trim(vucnno)) AS call_key,
          bm_approved_at
        FROM arcp_lines_hot
        WHERE NULLIF(trim(vucnno), '') IS NOT NULL
          AND NOT is_rejected
        ORDER BY
          upper(trim(vucnno)),
          CASE WHEN ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
          ho_approved_at DESC NULLS LAST,
          bm_approved_at DESC NULLS LAST,
          ncode DESC
      )
      UPDATE calls_latest_hot h
      SET arcp_bm_approved_at = ap.bm_approved_at,
          synced_at = now()
      FROM arcp_pick ap
      WHERE upper(trim(h.vtrnno)) = ap.call_key
        AND ap.bm_approved_at IS NOT NULL
        ${missingClause}
    `);

    const rowsUpdated = result.rowCount ?? 0;
    console.log(`[backfill-arcp-bm] Updated ${rowsUpdated} rows via vucnno match`);

    return { ok: true, rowsUpdated };
  });
}
