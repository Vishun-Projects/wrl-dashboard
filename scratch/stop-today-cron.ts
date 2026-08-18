import '@/modules/mis-email/services/bootstrap-env';
import { setVpsCronPaused, listVpsCronJobStatus } from '@/lib/vps-cron/settings';
import { closePool } from '@/lib/read-model/db';

async function main() {
  console.log('Pausing mis_email_digest and mis_email_watchdog in production database...');
  await setVpsCronPaused('mis_email_digest', true);
  await setVpsCronPaused('mis_email_watchdog', true);
  
  const jobs = await listVpsCronJobStatus();
  console.log('Current VPS Cron status:', JSON.stringify(jobs, null, 2));
}

main()
  .catch((err) => {
    console.error('Failed to pause cron:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
