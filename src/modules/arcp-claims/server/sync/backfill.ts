import { createHash } from 'crypto';
import { withClient, withTransaction } from '@/lib/read-model/db';
import {
  completeIngestBatch,
  finishSyncRunLog,
  startIngestBatch,
  startSyncRunLog,
} from '@/lib/read-model/batches';
import { formatLocalDate } from '@/lib/dates/local-date';
import { splitDateRangeByDays, todayLocalDate } from '@/lib/read-model/dates';
import { arcpBackfillStartDate } from '@/modules/arcp-claims/server/sync/dates';
import { fetchArcpRowsForRange } from '@/modules/arcp-claims/server/sync/crm-fetch';
import { ARCP_ENTITY, updateArcpSyncWatermarks } from '@/modules/arcp-claims/server/sync/lock';
import { maxArcpWatermarks, processArcpRows } from '@/modules/arcp-claims/server/sync/transform';
import { invalidateArcpPostgresCoverageCache } from '@/modules/arcp-claims/server/sync/coverage-query';
import { countArcpRows, truncateArcpLines, upsertArcpRows } from '@/modules/arcp-claims/server/sync/upsert';

async function arcpBackfillResumeFrom(client: import('pg').PoolClient): Promise<string | null> {
  const result = await client.query(`
    SELECT MAX(call_at) AS max_call FROM arcp_lines_hot WHERE call_at IS NOT NULL
  `);
  const maxCall = result.rows[0]?.max_call;
  if (!maxCall) return null;
  const next = new Date(maxCall);
  next.setDate(next.getDate() + 1);
  return formatLocalDate(next);
}

function laterDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export async function runArcpBackfill(opts?: {
  /** When true, truncate and restart from ARCP_BACKFILL_START_DATE. Prefer `arcp-reset` instead. */
  forceReset?: boolean;
}): Promise<void> {
  const forceReset = opts?.forceReset ?? process.env.ARCP_BACKFILL_FORCE_RESET === 'true';
  const endDate = todayLocalDate();

  const configuredStart = arcpBackfillStartDate();
  const existing = await withClient((client) => countArcpRows(client));
  const resumeFrom = await withClient((client) => arcpBackfillResumeFrom(client));

  // Never wipe existing rows on a normal restart — only explicit reset / FORCE_RESET.
  const resume = !forceReset && existing > 0;

  console.log(
    `[arcp-sync] Starting backfill ${configuredStart} .. ${endDate}${
      forceReset ? ' (force reset)' : resume ? ' (auto-resume)' : existing === 0 ? ' (empty table)' : ' (fresh)'
    }`
  );

  if (existing > 0 && forceReset) {
    console.log(
      `[arcp-sync] ARCP_BACKFILL_FORCE_RESET — truncating ${existing} rows and restarting from ${configuredStart}`
    );
  } else if (existing > 0) {
    console.log(
      `[arcp-sync] ${existing} rows in Postgres — keeping data (restart-safe). Wipe only via: npm run sync-worker:arcp-reset`
    );
  }

  let effectiveStart = configuredStart;
  if (resume && resumeFrom) {
    effectiveStart = laterDate(configuredStart, resumeFrom);
    console.log(`[arcp-sync] Resuming from ${effectiveStart} (${existing} rows already in Postgres)`);
  }

  await withTransaction(async (client) => {
    if (forceReset || existing === 0) {
      await truncateArcpLines(client);
      if (forceReset && existing > 0) {
        console.log('[arcp-sync] arcp_lines_hot truncated (force reset)');
      } else if (existing === 0) {
        console.log('[arcp-sync] arcp_lines_hot empty — starting from configured start date');
      }
      effectiveStart = configuredStart;
    } else {
      const purged = await client.query(
        `DELETE FROM arcp_lines_hot WHERE call_at IS NOT NULL AND call_at < $1::date`,
        [configuredStart]
      );
      if ((purged.rowCount ?? 0) > 0) {
        console.log(
          `[arcp-sync] Removed ${purged.rowCount} rows before ${configuredStart} (outside backfill window)`
        );
      }
      console.log(`[arcp-sync] Resume mode — keeping rows from ${configuredStart} onward`);
    }
    await client.query(
      `UPDATE sync_state SET status = 'backfilling', is_running = false WHERE entity = $1`,
      [ARCP_ENTITY]
    );
  });

  const batch = await withClient(async (client) => {
    const b = await startIngestBatch(client, ARCP_ENTITY, new Date(0));
    const logId = await startSyncRunLog(client, ARCP_ENTITY, b.batchId);
    return { batchId: b.batchId, logId };
  });

  let totalUpserted = 0;
  let lastEditedon: Date | null = null;
  let lastAddedon: Date | null = null;

  const chunkDays = Number(process.env.ARCP_BACKFILL_CHUNK_DAYS ?? 1) || 1;

  try {
    const chunks = splitDateRangeByDays(effectiveStart, endDate, chunkDays);
    console.log(
      `[arcp-sync] ${chunks.length} periods (${chunkDays}-day CRM windows) — close ARCP report / dev CRM load while this runs`
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[arcp-sync] Fetching ${chunk.start} .. ${chunk.end} (${i + 1}/${chunks.length})`);
      const rows = await fetchArcpRowsForRange(chunk.start, chunk.end, undefined, 1);
      console.log(`[arcp-sync] CRM returned ${rows.length} rows for ${chunk.start}..${chunk.end}`);
      const wm = maxArcpWatermarks(rows);
      if (wm.lastEditedon && (!lastEditedon || wm.lastEditedon > lastEditedon)) {
        lastEditedon = wm.lastEditedon;
      }
      if (wm.lastAddedon && (!lastAddedon || wm.lastAddedon > lastAddedon)) {
        lastAddedon = wm.lastAddedon;
      }

      const hotRows = processArcpRows(rows);
      if (hotRows.length > 0) {
        const withBm = hotRows.filter((r) => r.bm_approved_at != null).length;
        const withHo = hotRows.filter((r) => r.ho_approved_at != null).length;
        const withApprove = hotRows.filter((r) => r.approve_at != null).length;
        const n = await withClient((client) => upsertArcpRows(client, hotRows, 50));
        totalUpserted += n;
        console.log(
          `[arcp-sync] Upserted ${n} rows (${chunk.start}..${chunk.end}) — BM approve: ${withBm}, HO approve: ${withHo}, effective: ${withApprove}`
        );
        invalidateArcpPostgresCoverageCache();
      }
    }

    const watermarks = { lastEditedon, lastAddedon };
    await withClient(async (client) => {
      await updateArcpSyncWatermarks(
        client,
        watermarks.lastEditedon,
        watermarks.lastAddedon,
        totalUpserted
      );
      const checksum = createHash('sha256')
        .update(String(totalUpserted))
        .digest('hex');
      await completeIngestBatch(
        client,
        batch.batchId,
        watermarks.lastEditedon,
        totalUpserted,
        'completed',
        checksum
      );
      await finishSyncRunLog(client, batch.logId, 'completed', {
        startedAt: new Date(),
        rowsUpserted: totalUpserted,
        rowsDeleted: 0,
      });
      await client.query(
        `UPDATE sync_state SET status = 'ok' WHERE entity = $1`,
        [ARCP_ENTITY]
      );
    });

    console.log(`[arcp-sync] Backfill complete — ${totalUpserted} rows upserted`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withClient(async (client) => {
      await completeIngestBatch(client, batch.batchId, null, 0, 'failed');
      await finishSyncRunLog(client, batch.logId, 'failed', {
        startedAt: new Date(),
        errorMessage: message,
      });
      await client.query(
        `UPDATE sync_state SET status = 'error', is_running = false WHERE entity = $1`,
        [ARCP_ENTITY]
      );
    });
    throw err;
  }
}

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
