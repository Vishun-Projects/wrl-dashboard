#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runArcpBackfill } from '@/lib/read-model/arcp/backfill';
import { resetArcpReadModel } from '@/lib/read-model/arcp/reset';
import { runArcpIncrementalSync } from '@/lib/read-model/arcp/incremental';
import { runInitialBackfill, runDimsRefresh } from '@/lib/read-model/backfill';
import { runFillYtdHot } from '@/lib/read-model/fill-ytd';
import { runBackfillHistoricalHot } from '@/lib/read-model/backfill-historical';
import { runIncrementalSync } from '@/lib/read-model/incremental';
import { runNightlyReconcile } from '@/lib/read-model/nightly';
import { runPipelineReconcile } from '@/lib/read-model/pipeline-reconcile';
import { runEditedonCatchupRange, runEditedonCatchupStep } from '@/lib/read-model/editedon-catchup';
import { todayLocalDate } from '@/lib/read-model/dates';
import { runRetentionJobs } from '@/lib/read-model/retention';
import { runBackfillCallsHotBmApproval } from '@/lib/read-model/backfill-bm-approval';

const INCREMENTAL_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 3 * 60 * 1000);
const DAEMON_MAX_CONSECUTIVE_FAILURES = Number(process.env.SYNC_DAEMON_MAX_FAILURES ?? 5) || 5;

function formatSyncWorkerError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND westerncrm\.com/i.test(raw) || /getaddrinfo ENOTFOUND westerncrm/i.test(raw)) {
    return `${raw} — check internet/VPN; sync reads CRM at westerncrm.com`;
  }
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && /ENOTFOUND/i.test(raw)) {
    try {
      const host = new URL(dbUrl.replace(/^postgresql:/, 'postgres:')).hostname;
      if (raw.includes(host)) {
        return `${raw} — verify DATABASE_URL resolves (${host}:5432 direct for sync worker)`;
      }
    } catch {
      /* ignore malformed URL */
    }
  }
  if (/timeout expired|Timeout expired/i.test(raw)) {
    return `${raw} — CRM query timed out; worker auto-splits into smaller hour/ncode windows and advances watermark per chunk`;
  }
  return raw;
}

async function runDaemon(): Promise<void> {
  console.log(`[sync-worker] Daemon started — incremental every ${INCREMENTAL_INTERVAL_MS / 1000}s`);
  let consecutiveFailures = 0;
  for (;;) {
    try {
      const result = await runIncrementalSync();
      if (result.ok && !result.skipped) {
        consecutiveFailures = 0;
      } else if (!result.ok) {
        consecutiveFailures += 1;
      }
      if (process.env.SYNC_ARCP_ENABLED === 'true') {
        await runArcpIncrementalSync();
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error('[sync-worker] Incremental failed:', formatSyncWorkerError(err));
      if (consecutiveFailures >= DAEMON_MAX_CONSECUTIVE_FAILURES) {
        console.error(
          `[sync-worker] ${consecutiveFailures} consecutive incremental failures — check CRM connectivity and DATABASE_URL`
        );
        consecutiveFailures = 0;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, INCREMENTAL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  switch (command) {
    case 'backfill':
      await runInitialBackfill({ resume: process.env.SYNC_BACKFILL_RESUME === 'true' });
      break;
    case 'incremental':
      await runIncrementalSync();
      break;
    case 'pipeline-reconcile': {
      const result = await runPipelineReconcile();
      console.log('[sync-worker] Pipeline reconcile:', result);
      break;
    }
    case 'editedon-catchup': {
      const args = process.argv.slice(3);
      const fromIdx = args.indexOf('--from');
      const toIdx = args.indexOf('--to');
      const from =
        fromIdx >= 0 ? args[fromIdx + 1] : process.env.SYNC_EDITEDON_CATCHUP_FROM;
      const to =
        toIdx >= 0
          ? args[toIdx + 1]
          : process.env.SYNC_EDITEDON_CATCHUP_TO ?? todayLocalDate();
      const result = from
        ? await runEditedonCatchupRange(from, to)
        : await runEditedonCatchupStep();
      console.log('[sync-worker] Editedon catch-up:', result);
      break;
    }
    case 'backfill-bm-approval': {
      const result = await runBackfillCallsHotBmApproval({
        onlyMissing: process.env.BM_BACKFILL_ALL !== 'true',
      });
      console.log('[backfill-bm] Done:', result);
      break;
    }
    case 'dims':
      await runDimsRefresh();
      break;
    case 'fill-ytd':
      await runFillYtdHot();
      break;
    case 'backfill-historical':
      await runBackfillHistoricalHot();
      break;
    case 'nightly':
      await runNightlyReconcile();
      break;
    case 'retention':
      await runRetentionJobs();
      break;
    case 'arcp-reset':
      await resetArcpReadModel();
      break;
    case 'arcp-backfill':
      await runArcpBackfill({
        forceReset: process.env.ARCP_BACKFILL_FORCE_RESET === 'true',
      });
      break;
    case 'arcp-incremental':
      await runArcpIncrementalSync();
      break;
    case 'arcp-nightly':
      await runArcpIncrementalSync();
      break;
    case 'daemon':
      await runDaemon();
      break;
    default:
      console.log(`
Read model sync worker

Usage: npx tsx src/lib/read-model/cli.ts <command>

Commands:
  backfill          Full reload: TRUNCATE hot + YTD CRM load + facts (use once)
  fill-ytd          Upsert YTD + open-old only — no truncate (safe refresh)
  backfill-historical  Upsert pre-YTD CRM calls (default 2020-01-01 .. day before Jan 1) — no truncate
  incremental       Single calls incremental sync run (+ pipeline reconcile + editedon catch-up)
  pipeline-reconcile  Refresh stale open/assigned hot rows from CRM by TRN
  editedon-catchup  Replay CRM edits by editedon day (addedon <> editedon)
                    --from YYYY-MM-DD --to YYYY-MM-DD  (default: one step from cursor)
  backfill-bm-approval  Fill calls_latest_hot.bapproval / bm_approved_at from CRM (no truncate)
  arcp-reset        Truncate arcp_lines_hot + reset sync_state (fresh start)
  arcp-backfill     Initial ARCP lines backfill (ARCP_BACKFILL_START_DATE or YEARS)
  arcp-incremental  Single ARCP incremental sync run
  arcp-nightly      ARCP incremental only (for Task Scheduler / cron)
  dims              Refresh dimension tables only
  nightly           Calls nightly + ARCP incremental when SYNC_ARCP_ENABLED=true
  retention         Purge old sync logs and ingest batches
  daemon            Loop calls + ARCP incremental (optional; app auto-sync is default)

Live sync: PostgresAutoSync in the app (see docs/sync.md). Use daemon only if you need
sync while no browser is open.

Environment:
  DATABASE_URL           VPS Postgres (api.wrl-fsm.cloud; CLI uses direct :5432)
  SYNC_WORKER_ENABLED    Must be "true" for incremental/nightly/daemon
  SYNC_ARCP_ENABLED      Run ARCP incremental in daemon / API sync
  SYNC_INTERVAL_MS       Daemon interval (default 180000)
  SYNC_PIPELINE_RECONCILE_ENABLED  Re-check open/assigned hot rows each incremental (default true)
  SYNC_PIPELINE_RECONCILE_BATCH   Pipeline TRNs checked per run (default 400)
  SYNC_EDITEDON_CATCHUP_ENABLED   Replay editedon day windows each incremental (default true)
  SYNC_EDITEDON_CATCHUP_DAYS_PER_RUN  Calendar days per incremental catch-up step (default 1)
  SYNC_EDITEDON_CATCHUP_FROM      Optional start for editedon-catchup CLI (default YTD)
  SYNC_HISTORICAL_START_DATE First day for backfill-historical (default 2020-01-01)
  SYNC_PRE_YTD_START_DATE    Alias for SYNC_HISTORICAL_START_DATE
  SYNC_BACKFILL_CHUNK_DAYS     CRM days per backfill request (default 14)
  SYNC_BACKFILL_FETCH_GAP_MS   Pause between backfill CRM chunks (default 400)
  SYNC_HOT_UPSERT_BATCH        Postgres upsert batch size (default 300)
  ARCP_BACKFILL_START_DATE   First day to load (e.g. 2025-01-01; skips earlier years)
  ARCP_BACKFILL_YEARS        Fallback window if START_DATE unset (default 1)
  ARCP_BACKFILL_FORCE_RESET  Truncate existing rows (prefer: npm run sync-worker:arcp-reset)
`);
      process.exitCode = command === 'help' ? 0 : 1;
  }
}

main()
  .catch((err) => {
    console.error('[sync-worker] Fatal:', formatSyncWorkerError(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.argv[2] !== 'daemon') {
      await closePool();
    }
  });
