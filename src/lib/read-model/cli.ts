#!/usr/bin/env node
import { loadEnv, closePool } from '@/lib/read-model/db';
import { runInitialBackfill, runDimsRefresh } from '@/lib/read-model/backfill';
import { runIncrementalSync } from '@/lib/read-model/incremental';
import { runNightlyReconcile } from '@/lib/read-model/nightly';
import { runRetentionJobs } from '@/lib/read-model/retention';

loadEnv();
process.env.USE_DIRECT_DATABASE = 'true';

const INCREMENTAL_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 3 * 60 * 1000);

async function runDaemon(): Promise<void> {
  console.log(`[sync-worker] Daemon started — incremental every ${INCREMENTAL_INTERVAL_MS / 1000}s`);
  for (;;) {
    try {
      await runIncrementalSync();
    } catch (err) {
      console.error('[sync-worker] Incremental failed:', err instanceof Error ? err.message : err);
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
    case 'dims':
      await runDimsRefresh();
      break;
    case 'nightly':
      await runNightlyReconcile();
      break;
    case 'retention':
      await runRetentionJobs();
      break;
    case 'daemon':
      await runDaemon();
      break;
    default:
      console.log(`
Read model sync worker

Usage: npx tsx src/lib/read-model/cli.ts <command>

Commands:
  backfill     Initial backfill (dims + hot 90d + open-old + YTD facts)
  incremental  Single incremental sync run
  dims         Refresh dimension tables only
  nightly      Nightly reconcile (hot refresh + fact rebuild + dims)
  retention    Purge old sync logs and ingest batches
  daemon       Loop incremental sync every SYNC_INTERVAL_MS (default 3 min)

Environment:
  DATABASE_URL           Supabase Postgres (direct :5432 recommended)
  SYNC_WORKER_ENABLED    Must be "true" for incremental/nightly/daemon
  SYNC_INTERVAL_MS       Daemon interval (default 180000)
`);
      process.exitCode = command === 'help' ? 0 : 1;
  }
}

main()
  .catch((err) => {
    console.error('[sync-worker] Fatal:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.argv[2] !== 'daemon') {
      await closePool();
    }
  });
