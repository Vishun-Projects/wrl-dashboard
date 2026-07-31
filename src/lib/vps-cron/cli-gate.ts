/**
 * CLI gate for VPS bash wrappers.
 * Exit 0 = run job. Exit 2 = paused in portal (wrappers treat as soft skip).
 * Usage: npx tsx src/lib/vps-cron/cli-gate.ts <jobId>
 */
import '@/features/mis-email/services/bootstrap-env';
import { isVpsCronJobId } from '@/lib/vps-cron/catalog';
import { isVpsCronPaused } from '@/lib/vps-cron/settings';
import { closePool } from '@/lib/read-model/db';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!isVpsCronJobId(jobId)) {
    console.error(`vps-cron-gate: unknown job id: ${jobId ?? '(missing)'}`);
    process.exitCode = 1;
    return;
  }
  const paused = await isVpsCronPaused(jobId);
  if (paused) {
    console.log(`vps-cron-gate: SKIP ${jobId} (paused in portal)`);
    process.exitCode = 2;
    return;
  }
  console.log(`vps-cron-gate: RUN ${jobId}`);
}

main()
  .catch((err) => {
    console.error('vps-cron-gate: failed', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      /* ignore */
    }
  });
