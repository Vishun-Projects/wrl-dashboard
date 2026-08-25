import '@/modules/mis-email/services/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runTodayReconciliation } from './reconcile-runner';
import { triggerSubcontractorEmails } from './email-sender';
import { getSubcontractorConfig } from './settings';

function getCurrentIstMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  try {
    switch (command) {
      case 'reconcile': {
        console.log('[subcontractor-stock] Running reconciliation...');
        const result = await runTodayReconciliation();
        console.log(
          `[subcontractor-stock] Reconciliation complete: ${result.summary.totalRecords} records, ${result.summary.matches} matches, ${result.summary.discrepancies} discrepancies.`
        );
        break;
      }
      case 'send-emails': {
        console.log('[subcontractor-stock] Triggering email dispatches...');
        const result = await triggerSubcontractorEmails({ force: true });
        console.log(`[subcontractor-stock] Email trigger complete. Sent to ${result.sentCount} recipients.`);
        break;
      }
      case 'cron': {
        const currentMinutes = getCurrentIstMinutes();
        console.log(`[subcontractor-stock] Cron check: current time in IST is ${Math.floor(currentMinutes / 60)}:${String(currentMinutes % 60).padStart(2, '0')} (${currentMinutes} mins)`);

        // 1. Reconciliation: Run at 7:00 AM IST (420 minutes)
        // Check window: [07:00, 07:15)
        if (currentMinutes >= 420 && currentMinutes < 435) {
          console.log('[subcontractor-stock] Within 7:00 AM window. Running reconciliation...');
          try {
            const result = await runTodayReconciliation();
            console.log(`[subcontractor-stock] Reconciliation completed. Total: ${result.summary.totalRecords}`);
          } catch (reconErr: any) {
            console.error('[subcontractor-stock] Auto reconciliation failed:', reconErr.message || reconErr);
          }
        }

        // 2. Emails: Run at user-configured send_time_ist (default 08:00)
        const sendTimeStr = (await getSubcontractorConfig('send_time_ist')) || '08:00';
        const sendTimeMinutes = timeToMinutes(sendTimeStr);
        console.log(`[subcontractor-stock] Configured send time: ${sendTimeStr} (${sendTimeMinutes} mins)`);

        // Check window: [sendTime, sendTime + 15)
        if (currentMinutes >= sendTimeMinutes && currentMinutes < sendTimeMinutes + 15) {
          console.log(`[subcontractor-stock] Within send window [${sendTimeStr}]. Triggering emails...`);
          try {
            const result = await triggerSubcontractorEmails();
            console.log(`[subcontractor-stock] Auto email trigger completed. Sent to ${result.sentCount} recipients.`);
          } catch (emailErr: any) {
            console.error('[subcontractor-stock] Auto email dispatch failed:', emailErr.message || emailErr);
          }
        }
        break;
      }
      default: {
        console.log('Usage: npx tsx src/modules/subcontractor-stock/services/cli.ts <reconcile|send-emails|cron>');
        break;
      }
    }
  } catch (err: any) {
    console.error(`[subcontractor-stock] Command '${command}' failed:`, err.message || err);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[subcontractor-stock] Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      // ignore
    }
  });
