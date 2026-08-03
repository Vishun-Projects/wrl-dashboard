#!/usr/bin/env node
import '@/lib/read-model/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runArcpBackfill } from '@/modules/arcp/server/sync/backfill';
import { resetArcpReadModel } from '@/modules/arcp/server/sync/backfill';
import { runArcpIncrementalSync } from '@/modules/arcp/server/sync/incremental';
import { runInitialBackfill, runDimsRefresh } from '@/lib/read-model/backfill';
import { runFillYtdHot } from '@/lib/read-model/sync-hot-ytd';
import { runBackfillHistoricalHot } from '@/lib/read-model/sync-hot-ytd';
import { runFillHotGaps } from '@/lib/read-model/fill-hot-gaps';
import { runIncrementalSync } from '@/lib/read-model/incremental';
import { runNightlyReconcile } from '@/lib/read-model/nightly';
import { runPipelineReconcile } from '@/lib/read-model/pipeline-reconcile';
import { runReconcileYtdOpen } from '@/lib/read-model/reconcile-ytd-open';
import { runReconcileTechSolved } from '@/lib/read-model/reconcile-tech-solved';
import { runReconcileMajor } from '@/lib/read-model/reconcile-major';
import { runHotCrmMismatchSampleCheck } from '@/lib/read-model/check-hot-crm-mismatch';
import { runEditedonCatchupRange, runEditedonCatchupStep } from '@/lib/read-model/editedon-catchup';
import { todayLocalDate } from '@/lib/read-model/dates';
import { runRetentionJobs } from '@/lib/read-model/batches';
import { runBackfillCallsHotBmApproval } from '@/lib/read-model/backfill-bm-approval';
import { runBackfillArcpBmApproved } from '@/modules/arcp/server/sync/backfill-arcp-bm-approved';
import { runBackfillCallsHotWco } from '@/lib/read-model/backfill-wco';
import {
  runTransactionEntryBackfill,
  runTransactionEntryIncremental,
} from '@/lib/read-model/transaction-entry';
import {
  auditExitCode,
  parseAuditCliArgs,
  runFullReadModelAudit,
} from '@/lib/read-model/audit/run-full-audit';
import { logAction } from '@/lib/security/audit';

const INCREMENTAL_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 3 * 60 * 1000);
const DAEMON_MAX_CONSECUTIVE_FAILURES = Number(process.env.SYNC_DAEMON_MAX_FAILURES ?? 5) || 5;

const SYNC_SCHEDULE_ACTOR = {
  userId: null,
  email: 'system:sync-schedule',
  name: 'Sync schedule',
};

/** ponytail: skip audit when coalesced/skipped; daemon omits start to avoid ~480 noise rows/day. */
async function auditScheduledSync<T extends { ok?: boolean; skipped?: boolean; reason?: string }>(
  mode: string,
  run: () => Promise<T>,
  opts?: { logStart?: boolean }
): Promise<T> {
  const startedAt = Date.now();
  const logStart = opts?.logStart !== false;
  if (logStart) {
    await logAction({
      action: 'sync.schedule.start',
      actor: SYNC_SCHEDULE_ACTOR,
      result: 'started',
      statusCode: 202,
      summary: `Started scheduled sync (${mode})`,
      metadata: { mode },
    });
  }
  try {
    const result = await run();
    const durationMs = Date.now() - startedAt;
    if (result?.skipped) {
      return result;
    }
    if (result && 'ok' in result && result.ok === false) {
      await logAction({
        action: 'sync.schedule.failure',
        actor: SYNC_SCHEDULE_ACTOR,
        result: 'failure',
        statusCode: 500,
        summary: `Scheduled sync failed (${mode})`,
        metadata: { mode, durationMs, reason: result.reason ?? null, result },
      });
      return result;
    }
    await logAction({
      action: 'sync.schedule.complete',
      actor: SYNC_SCHEDULE_ACTOR,
      result: 'completed',
      statusCode: 200,
      summary: `Completed scheduled sync (${mode})`,
      metadata: { mode, durationMs, result },
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    await logAction({
      action: 'sync.schedule.failure',
      actor: SYNC_SCHEDULE_ACTOR,
      result: 'failure',
      statusCode: 500,
      summary: `Scheduled sync failed (${mode})`,
      metadata: { mode, durationMs, message },
    });
    throw err;
  }
}

async function auditScheduledNightly(run: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  await logAction({
    action: 'sync.schedule.start',
    actor: SYNC_SCHEDULE_ACTOR,
    result: 'started',
    statusCode: 202,
    summary: 'Started scheduled sync (nightly)',
    metadata: { mode: 'nightly' },
  });
  try {
    await run();
    await logAction({
      action: 'sync.schedule.complete',
      actor: SYNC_SCHEDULE_ACTOR,
      result: 'completed',
      statusCode: 200,
      summary: 'Completed scheduled sync (nightly)',
      metadata: { mode: 'nightly', durationMs: Date.now() - startedAt },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAction({
      action: 'sync.schedule.failure',
      actor: SYNC_SCHEDULE_ACTOR,
      result: 'failure',
      statusCode: 500,
      summary: 'Scheduled sync failed (nightly)',
      metadata: { mode: 'nightly', durationMs: Date.now() - startedAt, message },
    });
    throw err;
  }
}

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
      const result = await auditScheduledSync(
        'daemon-incremental',
        () => runIncrementalSync(),
        { logStart: false }
      );
      if (result.ok && !result.skipped) {
        consecutiveFailures = 0;
      } else if (!result.ok) {
        consecutiveFailures += 1;
      }
      // Isolate ARCP / TE so one failing job cannot starve the others (Deployment Completion).
      if (process.env.SYNC_ARCP_ENABLED === 'true') {
        try {
          await runArcpIncrementalSync();
        } catch (arcpErr) {
          console.error('[arcp-sync] Daemon incremental failed:', formatSyncWorkerError(arcpErr));
        }
      }
      if (process.env.SYNC_TRANSACTION_ENTRY_ENABLED !== 'false') {
        try {
          const te = await runTransactionEntryIncremental();
          if (te.skipped) {
            console.log(`[transaction-entry] Daemon skip — ${te.reason}`);
          }
        } catch (teErr) {
          console.error('[transaction-entry] Daemon incremental failed:', formatSyncWorkerError(teErr));
        }
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
      await auditScheduledSync('incremental', () => runIncrementalSync());
      break;
    case 'pipeline-reconcile': {
      const result = await runPipelineReconcile();
      console.log('[sync-worker] Pipeline reconcile:', result);
      break;
    }
    case 'reconcile-ytd-open': {
      const result = await runReconcileYtdOpen({ apply: process.argv.includes('--apply') });
      console.log('[sync-worker] YTD open reconcile:', result);
      break;
    }
    case 'reconcile-tech-solved': {
      const result = await runReconcileTechSolved({ apply: process.argv.includes('--apply') });
      console.log('[sync-worker] tech_solved reconcile:', result);
      break;
    }
    case 'reconcile-major': {
      const result = await runReconcileMajor();
      console.log('[sync-worker] Major reconcile:', result);
      break;
    }
    case 'hot-crm-mismatch-sample': {
      const result = await runHotCrmMismatchSampleCheck();
      if (result.mismatches > 0) process.exitCode = 1;
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
    case 'backfill-arcp-bm': {
      const result = await runBackfillArcpBmApproved({
        onlyMissing: process.env.ARCP_BM_BACKFILL_ALL !== 'true',
      });
      console.log('[backfill-arcp-bm] Done:', result);
      break;
    }
    case 'backfill-wco': {
      const args = process.argv.slice(3);
      const fromIdx = args.indexOf('--from');
      const toIdx = args.indexOf('--to');
      const fromDate =
        fromIdx >= 0 ? args[fromIdx + 1] : process.env.WCO_BACKFILL_FROM ?? null;
      const toDate = toIdx >= 0 ? args[toIdx + 1] : process.env.WCO_BACKFILL_TO ?? null;
      const result = await runBackfillCallsHotWco({ fromDate, toDate });
      console.log('[backfill-wco] Done:', result);
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
    case 'fill-hot-gaps':
      await runFillHotGaps();
      break;
    case 'nightly':
      await auditScheduledNightly(() => runNightlyReconcile());
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
    case 'transaction-entry-backfill':
      await runTransactionEntryBackfill();
      break;
    case 'transaction-entry-incremental':
      await runTransactionEntryIncremental();
      break;
    case 'transaction-entry-scrub':
      await runTransactionEntryIncremental({ full: true });
      break;
    case 'transaction-entry-verify': {
      const { healCallRegisterMismatches } = await import('@/lib/read-model/transaction-entry');
      const toIdx = process.argv.indexOf('--to');
      const dateTo = toIdx >= 0 ? process.argv[toIdx + 1]! : todayLocalDate();
      // Heal uses TRANSACTION_ENTRY_VERIFY_DAYS lookback ending at dateTo
      const healed = await healCallRegisterMismatches(dateTo);
      console.log(`[transaction-entry] verify/heal upserted ${healed}`);
      break;
    }
    case 'daemon':
      await runDaemon();
      break;
    case 'full-audit': {
      const opts = parseAuditCliArgs(process.argv.slice(3));
      const summary = await runFullReadModelAudit(opts);
      process.exitCode = auditExitCode(summary);
      break;
    }
    default:
      console.log(`
Read model sync worker

Usage: npx tsx src/lib/read-model/cli.ts <command>

Commands:
  backfill          Full reload: TRUNCATE hot + YTD CRM load + facts (use once)
  fill-ytd          Upsert YTD + open-old only — no truncate (safe refresh)
  backfill-historical  Upsert pre-YTD CRM calls (default 2020-01-01 .. day before Jan 1) — no truncate
  fill-hot-gaps        Missing INSTALLATION CALL TRNs (full joins) + short-day corpus refill
                       --from YYYY-MM-DD --to YYYY-MM-DD | --serial S | --trn TRN
                       --installations-only | --skip-installations
  incremental       Single calls incremental sync run (+ pipeline reconcile + editedon catch-up)
  pipeline-reconcile  Refresh stale open/assigned/tech_solved hot rows from CRM by TRN (incl. transferred)
  reconcile-ytd-open  Full YTD open/assigned/tech_solved scan vs CRM (--apply to fix)
  reconcile-tech-solved  Refresh stale tech_solved rows from CRM (--apply to fix)
  reconcile-major       Refresh open TRNs for major/minor + recent fault edits
  hot-crm-mismatch-sample  Sample open/terminal hot vs CRM (exit 1 on mismatch)
  editedon-catchup  Replay CRM edits by editedon day (addedon <> editedon)
                    --from YYYY-MM-DD --to YYYY-MM-DD  (default: one step from cursor)
  backfill-bm-approval  Fill calls_latest_hot.bapproval / bm_approved_at from CRM (no truncate)
  backfill-arcp-bm      Fill calls_latest_hot.arcp_bm_approved_at from arcp_lines_hot (no truncate)
  backfill-wco          Fill calls_latest_hot.wco from CRM mstprorg (no truncate)
                    --from YYYY-MM-DD --to YYYY-MM-DD  (optional hot logged_at window)
  arcp-reset        Truncate arcp_lines_hot + reset sync_state (fresh start)
  arcp-backfill     Initial ARCP lines backfill (ARCP_BACKFILL_START_DATE or YEARS)
  arcp-incremental  Single ARCP incremental sync run
  arcp-nightly      ARCP incremental only (for Task Scheduler / cron)
  transaction-entry-backfill     Initial/resume CRM TransactionEntry → crm_transaction_entry
  transaction-entry-incremental  Re-sync last N months of TransactionEntry (default 2)
  transaction-entry-scrub        Full-history replace sync (start date → today) — drops unprocessed orphans
  transaction-entry-verify       Compare CRM vs mirror for all TransactionEntry clients; re-fetch mismatches
                    --to YYYY-MM-DD  (default today; lookback = TRANSACTION_ENTRY_VERIFY_DAYS)
  dims              Refresh dimension tables only
  nightly           Calls nightly + ARCP + TransactionEntry when enabled
  retention         Purge old sync logs and ingest batches
  full-audit        Full read-model audit vs live CRM (see scripts/ops/audit-read-model-full.ts)
                    --apply  refresh stale rows; --only hot,dims,facts; --resume-from-trn TRN
  daemon            Loop calls + ARCP + TransactionEntry incremental

Live sync: PostgresAutoSync in the app (see docs/sync.md). Use daemon only if you need
sync while no browser is open.

Environment:
  DATABASE_URL           VPS Postgres (api.wrl-fsm.cloud; CLI uses direct :5432)
  SYNC_WORKER_ENABLED    Must be "true" for incremental/nightly/daemon
  SYNC_ARCP_ENABLED      Run ARCP incremental in daemon / API sync
  SYNC_TRANSACTION_ENTRY_ENABLED  TransactionEntry sync in daemon/nightly (default on; set false to disable)
  TRANSACTION_ENTRY_RECENT_DAYS   Recent-window bulk refresh for all CRM clients (default 14)
  TRANSACTION_ENTRY_VERIFY_ENABLED  After incremental: heal CRM vs mirror mismatches (default on)
  TRANSACTION_ENTRY_VERIFY_DAYS   Days to verify/heal after each incremental (default 7)
  TRANSACTION_ENTRY_START_DATE    Backfill/scrub start (default 2024-01-01)
  TRANSACTION_ENTRY_OVERLAP_MONTHS  Incremental lookback months (default 2)
  TRANSACTION_ENTRY_FULL          If true, incremental = full scrub from start date
  TRANSACTION_ENTRY_BACKFILL_GAP_MS Pause between scrub/backfill weeks (default 1500)
  TRANSACTION_ENTRY_BACKFILL_CHUNK  Backfill window: week (default) | month | year
  TRANSACTION_ENTRY_PERIOD_PARALLEL Backfill periods in flight (default 1)
  TRANSACTION_ENTRY_BACKFILL_GAP_MS Pause between backfill periods (default 1500)
  TRANSACTION_ENTRY_FETCH_GAP_MS  Pause between CRM OOM-split slices (default 1000)
  TRANSACTION_ENTRY_CLIENT_PARALLEL Per-client CRM fallback concurrency (default 2)
  SYNC_INTERVAL_MS       Daemon interval (default 180000)
  SYNC_PIPELINE_RECONCILE_ENABLED  Re-check open/assigned/tech_solved hot rows each incremental (default true)
  SYNC_PIPELINE_RECONCILE_BATCH   Pipeline TRNs checked per run (default 1000)
  SYNC_MAJOR_RECONCILE_ENABLED    Major/minor + fault-edit reconcile each incremental (default true)
  SYNC_MAJOR_RECONCILE_PER_RUN    Open TRNs checked per major reconcile (default 800)
  SYNC_FAULT_EDIT_LOOKBACK_HOURS  Fault editedon lookback for major reconcile (default 48)
  SYNC_TECH_SOLVED_RECONCILE_ENABLED  Refresh stale tech_solved each incremental (default true)
  RECONCILE_TECH_SOLVED_PER_RUN   tech_solved TRNs checked per incremental (default 800)
  SYNC_EDITEDON_CATCHUP_ENABLED   Replay editedon day windows each incremental (default true)
  SYNC_EDITEDON_RECENT_DAYS       Always replay last N days each incremental (default 2)
  SYNC_EDITEDON_CATCHUP_DAYS_PER_RUN  Extra rotating YTD days per incremental (default 1)
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
