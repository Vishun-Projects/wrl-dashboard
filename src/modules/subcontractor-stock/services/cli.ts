import '@/modules/mis-email/services/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runTodayReconciliation } from './reconcile-runner';
import { triggerSubcontractorEmails } from './email-sender';
import { getSubcontractorConfig, getTodaySubcontractorRun } from './settings';
import { syncSapMailInbox, getLatestTodaySapFileMtimeMs } from './sap-inbox';

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

async function maybeReconcileNewTodayFiles(): Promise<void> {
  const latestFileMtime = getLatestTodaySapFileMtimeMs();
  if (latestFileMtime === null) return;

  const todayRun = await getTodaySubcontractorRun();
  const reconciledAtMs = todayRun?.reconciledAt
    ? new Date(todayRun.reconciledAt).getTime()
    : 0;

  if (latestFileMtime <= reconciledAtMs) {
    console.log('[subcontractor-stock] No new SAP files since last reconcile — skipping auto-reconcile.');
    return;
  }

  console.log('[subcontractor-stock] New SAP files detected — running reconciliation...');
  try {
    const result = await runTodayReconciliation();
    console.log(
      `[subcontractor-stock] Auto-reconcile completed. Total: ${result.summary.totalRecords}`
    );
  } catch (reconErr: unknown) {
    const message = reconErr instanceof Error ? reconErr.message : String(reconErr);
    console.error('[subcontractor-stock] Auto reconciliation failed:', message);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  try {
    switch (command) {
      case 'sync-inbox': {
        console.log('[subcontractor-stock] Syncing SAP mail inbox...');
        const result = await syncSapMailInbox();
        console.log(
          `[subcontractor-stock] Inbox sync complete: ${result.upserted} upserted, ${result.entries.length} rows in window.`
        );
        break;
      }
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
        const toArg = process.argv.find((a) => a.startsWith('--to='))?.slice('--to='.length);
        const result = await triggerSubcontractorEmails({
          force: true,
          forceTo: toArg?.trim() || undefined,
        });
        console.log(`[subcontractor-stock] Email trigger complete. Sent to ${result.sentCount} recipients.`);
        break;
      }
      case 'cron': {
        const currentMinutes = getCurrentIstMinutes();
        console.log(
          `[subcontractor-stock] Cron check: current time in IST is ${Math.floor(currentMinutes / 60)}:${String(currentMinutes % 60).padStart(2, '0')} (${currentMinutes} mins)`
        );

        try {
          await syncSapMailInbox();
        } catch (syncErr: unknown) {
          const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
          console.error('[subcontractor-stock] Inbox sync failed:', message);
        }

        // 1. Reconciliation: Run at 7:00 AM IST (420 minutes)
        if (currentMinutes >= 420 && currentMinutes < 435) {
          console.log('[subcontractor-stock] Within 7:00 AM window. Running reconciliation...');
          try {
            const result = await runTodayReconciliation();
            console.log(`[subcontractor-stock] Reconciliation completed. Total: ${result.summary.totalRecords}`);
          } catch (reconErr: unknown) {
            const message = reconErr instanceof Error ? reconErr.message : String(reconErr);
            console.error('[subcontractor-stock] Auto reconciliation failed:', message);
          }
        } else {
          await maybeReconcileNewTodayFiles();
        }

        // 2. Emails: Run at user-configured send_time_ist (default 08:00)
        const sendTimeStr = (await getSubcontractorConfig('send_time_ist')) || '08:00';
        const sendTimeMinutes = timeToMinutes(sendTimeStr);
        console.log(`[subcontractor-stock] Configured send time: ${sendTimeStr} (${sendTimeMinutes} mins)`);

        if (currentMinutes >= sendTimeMinutes && currentMinutes < sendTimeMinutes + 15) {
          console.log(`[subcontractor-stock] Within send window [${sendTimeStr}]. Triggering emails...`);
          try {
            const result = await triggerSubcontractorEmails();
            console.log(`[subcontractor-stock] Auto email trigger completed. Sent to ${result.sentCount} recipients.`);
          } catch (emailErr: unknown) {
            const message = emailErr instanceof Error ? emailErr.message : String(emailErr);
            console.error('[subcontractor-stock] Auto email dispatch failed:', message);
          }
        }
        break;
      }
      default: {
        console.log(
          'Usage: npx tsx src/modules/subcontractor-stock/services/cli.ts <sync-inbox|reconcile|send-emails|cron>'
        );
        break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[subcontractor-stock] Command '${command}' failed:`, message);
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
