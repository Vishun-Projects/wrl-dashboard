#!/usr/bin/env node
import '@/lib/mis-email/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { runMisEmailDigest, runMisEmailTest, runMisEmailTestBatch } from '@/lib/mis-email/run-digest';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  const userIdArg = process.argv.find((a) => a.startsWith('--user='))?.slice('--user='.length);

  try {
    switch (command) {
      case 'digest': {
        const result = await runMisEmailDigest();
        console.log(
          `[mis-email] Digest complete — sent ${result.sent.length}, failed ${result.failed.length}, ${result.durationMs}ms`
        );
        if (result.failed.length) {
          for (const f of result.failed) {
            console.error(`  FAIL ${f.email}: ${f.error}`);
          }
          process.exitCode = 1;
        }
        break;
      }
      case 'test': {
        const toArg = process.argv.find((a) => a.startsWith('--to='))?.slice('--to='.length);
        const results = await runMisEmailTestBatch({ userId: userIdArg, recipientOverride: toArg });
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
      default:
        console.log(`Usage:
  npx tsx src/lib/mis-email/cli.ts digest
  npx tsx src/lib/mis-email/cli.ts test [--user=<uuid>]

Environment:
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM
  SMTP_USER + SMTP_PASS (Gmail etc.) OR SMTP_HOST=127.0.0.1 (VPS Postfix, no auth)
  MIS_EMAIL_TEST_TO (comma-separated; bare name → @gmail.com)
  DATABASE_URL, READ_SUMMARY_FROM=postgres`);
        process.exitCode = command === 'help' ? 0 : 1;
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('[mis-email] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
