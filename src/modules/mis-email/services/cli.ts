
import '@/modules/mis-email/services/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { sendMisEmailComposeBatch } from '@/modules/mis-email/services/compose-digest';
import {
  loadDigestRecipientById,
  loadDigestRecipients,
} from '@/modules/mis-email/services/recipients';
import type { MisEmailPreferences } from '@/modules/mis-email/services/preferences';
import {
  runMisEmailDigest,
  runMisEmailTestBatch,
} from '@/modules/mis-email/services/run-digest';
import { runMidnightCrmDeltaReport } from '@/modules/mis-email/services/midnight-crm-delta';
import { runCancelledCallDigest } from '@/modules/mis-email/services/cancelled-call-digest';
import { listMisEmailRoutingRules } from '@/modules/mis-email/services/routing-rules';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';

  const userIdArg = process.argv
    .find((a) => a.startsWith('--user='))
    ?.slice('--user='.length);

  try {
    switch (command) {
      case 'digest': {
        const result = await runMisEmailDigest();

        console.log(
          `[mis - email] Digest complete — sent ${result.sent.length}, failed ${result.failed.length}, ${result.durationMs} ms`
        );

        if (result.failed.length) {
          for (const f of result.failed) {
            console.error(`  FAIL ${f.email}: ${f.error} `);
          }

          process.exitCode = 1;
        }

        break;
      }

      case 'nightly-ytd-export':
      case 'midnight-crm-delta': {
        const dryRun = process.argv.includes('--dry-run');
        const toArg = process.argv.find((a) => a.startsWith('--to='))?.slice('--to='.length);
        const result = await runMidnightCrmDeltaReport({ to: toArg, dryRun });
        console.log(
          `[mis-email] Midnight CRM delta — ${result.dateRange.endDate} · rows=${result.exportRows} · total=${result.ytd.all} · baseline=${result.delta.baseline} · messageId=${result.messageId}`
        );
        break;
      }

      case 'cancelled-call-digest': {
        const dryRun = process.argv.includes('--dry-run');
        const force = process.argv.includes('--force');
        const dateArg = process.argv
          .find((a) => a.startsWith('--date='))
          ?.slice('--date='.length);
        const toArg = process.argv.find((a) => a.startsWith('--to='))?.slice('--to='.length);
        const branchArg = process.argv
          .find((a) => a.startsWith('--branch='))
          ?.slice('--branch='.length);
        const result = await runCancelledCallDigest({
          digestDate: dateArg,
          dryRun,
          force: force || Boolean(toArg),
          forceTo: toArg,
          branch: branchArg,
        });
        console.log(
          `[cancelled-call-digest] ${result.digestDate} — sent ${result.sent.length}, skipped ${result.skipped.length}, failed ${result.failed.length}, ${result.durationMs} ms`
        );
        for (const s of result.skipped) {
          console.log(`  SKIP ${s.branch}: ${s.reason} (${s.rowCount} rows)`);
        }
        for (const f of result.failed) {
          console.error(`  FAIL ${f.branch}: ${f.error}`);
        }
        if (result.failed.length) process.exitCode = 1;
        break;
      }

      case 'preview': {
        console.log('\n========================================');
        console.log('       MIS EMAIL DIGEST RECIPIENTS');
        console.log('========================================\n');

        /*
         * PERSONAL DIGEST RECIPIENTS
         *
         * These are loaded using the exact same recipient query
         * used by runMisEmailDigest().
         *
         * No email is sent here.
         */
        const recipients = await loadDigestRecipients();

        console.log('--- PERSONAL DIGEST ---\n');

        if (recipients.length === 0) {
          console.log('No eligible personal digest recipients.\n');
        } else {
          for (const recipient of recipients) {
            console.log(`Name: ${recipient.name} `);
            console.log(`Email: ${recipient.email} `);
            console.log(`Role: ${recipient.role} `);
            console.log(`User ID: ${recipient.id} `);
            console.log(
              `To: ${recipient.mis_email_preferences?.toEmails?.join(', ') || recipient.email} `
            );
            console.log(
              `CC: ${recipient.mis_email_preferences?.ccEmails?.join(', ') || '(none)'} `
            );
            console.log('----------------------------------------');
          }
        }

        /*
         * ROUTING DIGEST RECIPIENTS
         *
         * These come from the configured MIS email routing rules.
         *
         * No email is sent here.
         */
        const routingRules = await listMisEmailRoutingRules();

        console.log('\n--- ROUTING DIGEST ---\n');

        if (routingRules.length === 0) {
          console.log('No routing rules configured.\n');
        } else {
          for (const rule of routingRules) {
            console.log(
              `Rule: ${rule.zone || '*'} / ${rule.branch || '*'} / ${rule.client || '*'} `
            );
            console.log(`Auto Send: ${rule.autoSendEnabled} `);
            console.log(
              `To: ${rule.toEmails.length ? rule.toEmails.join(', ') : '(none)'} `
            );
            console.log(
              `CC: ${rule.ccEmails.length ? rule.ccEmails.join(', ') : '(none)'} `
            );
            console.log(
              `Schedule: ${rule.scheduleAnchorTimeIst} every ${rule.scheduleIntervalMinutes} m`
            );
            console.log('----------------------------------------');
          }
        }

        /*
         * SUMMARY
         */
        const personalEmails = recipients.map(
          (recipient) => recipient.email
        );

        const routingToEmails = routingRules.flatMap(
          (rule) => rule.toEmails
        );

        const routingCcEmails = routingRules.flatMap(
          (rule) => rule.ccEmails
        );

        const allEmails = [
          ...personalEmails,
          ...routingToEmails,
          ...routingCcEmails,
        ]
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean);

        const uniqueEmails = [...new Set(allEmails)];

        console.log('\n========================================');
        console.log('              SUMMARY');
        console.log('========================================\n');

        console.log(
          `Eligible personal recipients: ${recipients.length} `
        );
        console.log(`Routing rules: ${routingRules.length} `);
        console.log(
          `Unique email addresses: ${uniqueEmails.length} `
        );

        console.log('\n--- ALL UNIQUE EMAIL ADDRESSES ---\n');

        if (uniqueEmails.length === 0) {
          console.log('None');
        } else {
          uniqueEmails.forEach((email, index) => {
            console.log(`${index + 1}. ${email} `);
          });
        }

        console.log('\n========================================');
        console.log('Preview only — NO EMAIL WAS SENT.');
        console.log('========================================\n');

        break;
      }

      case 'send-user': {
        const payloadRaw = process.env.MIS_EMAIL_SEND_PAYLOAD?.trim();

        if (!payloadRaw) {
          throw new Error('MIS_EMAIL_SEND_PAYLOAD is required');
        }

        const payload = JSON.parse(
          Buffer.from(payloadRaw, 'base64').toString('utf8')
        ) as {
          userId?: string;
          preferences?: MisEmailPreferences;
          sendTo?: string[];
        };

        if (!payload.userId?.trim()) {
          throw new Error('userId is required');
        }

        const recipient = await loadDigestRecipientById(
          payload.userId.trim()
        );

        if (!recipient) {
          throw new Error(`Recipient not found: ${payload.userId} `);
        }

        const results = await sendMisEmailComposeBatch(recipient, {
          preferences: payload.preferences,
          sendTo: payload.sendTo,
          displayName: recipient.name,
        });

        console.log(JSON.stringify(results));

        break;
      }

      case 'test': {
        const toArg = process.argv
          .find((a) => a.startsWith('--to='))
          ?.slice('--to='.length);

        const ccArg = process.argv
          .find((a) => a.startsWith('--cc='))
          ?.slice('--cc='.length);

        const results = await runMisEmailTestBatch({
          userId: userIdArg,
          recipientOverride: toArg,
          ccOverride: ccArg,
        });

        for (const result of results) {
          console.log('[mis-email] Test email sent:', {
            sentTo: result.sentTo,
            scope: result.scopeLabel,
            attachments: result.attachments,
            messageId: result.messageId,
          });
        }

        break;
      }

      case 'reconcile-subcontractor': {
        const fileArg = process.argv
          .find((a) => a.startsWith('--file='))
          ?.slice('--file='.length);

        const outputArg = process.argv
          .find((a) => a.startsWith('--output='))
          ?.slice('--output='.length);

        if (!fileArg) {
          throw new Error('--file=<path> is required');
        }

        const { runSubcontractorReconciliation } = await import(
          '@/modules/subcontractor-stock/services/reconcile-runner'
        );

        const result = await runSubcontractorReconciliation({
          filePath: fileArg,
          outputPath: outputArg,
        });

        console.log(`\nReconciliation completed for plants: ${result.plantCodes.join(', ')}`);
        console.log(`Total Reconciled Records: ${result.summary.totalRecords}`);
        console.log(`Perfect Matches: ${result.summary.matches}`);
        console.log(`Discrepancies: ${result.summary.discrepancies}`);
        console.log(`  - Items only in SAP: ${result.summary.sapOnly}`);
        console.log(`  - Items only in CRM: ${result.summary.crmOnly}`);

        if (result.excelPath) {
          console.log(`Excel report saved to: ${result.excelPath}`);
        }

        console.log('\n--- SAMPLE RECONCILIATION (First 30 Rows) ---');
        console.table(
          result.rows.slice(0, 30).map((r) => ({
            Plant: r.plant,
            Vendor: r.vendor,
            'Vendor Name': r.vendorName.substring(0, 20),
            Material: r.material,
            Description: r.description.substring(0, 25),
            Group: r.group,
            UOM: r.uom,
            'SAP Qty': r.sapQty,
            'CRM Qty': r.crmQty,
            Difference: r.difference,
          }))
        );

        break;
      }

      default:
        console.log(`Usage:

npx tsx src / modules / mis - email / services / cli.ts digest

npx tsx src / modules / mis - email / services / cli.ts nightly-ytd-export [--to=email] [--dry-run]

npx tsx src / modules / mis - email / services / cli.ts preview

npx tsx src / modules / mis - email / services / cli.ts test[--user=][--to=a@x.com, b@y.com][--cc= c@z.com]

npx tsx src / modules / mis - email / services / cli.ts send - user
  (MIS_EMAIL_SEND_PAYLOAD = base64 json)

npx tsx src / modules / mis - email / services / cli.ts reconcile-subcontractor --file=<sap_html_path> [--output=<excel_out_path>]

Environment:
SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM
SMTP_USER + SMTP_PASS(Gmail etc.) OR SMTP_HOST = 127.0.0.1(VPS Postfix, no auth)
MIS_EMAIL_TEST_TO / MIS_EMAIL_TEST_CC(comma - separated; bare name → @gmail.com)
DATABASE_URL, READ_SUMMARY_FROM = postgres`);

        process.exitCode = command === 'help' ? 0 : 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(
    '[mis-email] Fatal:',
    err instanceof Error ? err.message : err
  );

  process.exit(1);
});
