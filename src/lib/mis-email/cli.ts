#!/usr/bin/env node
import '@/lib/mis-email/bootstrap-env';
import { closePool } from '@/lib/read-model/db';
import { sendMisEmailComposeBatch } from '@/lib/mis-email/compose-digest';
import { loadDigestRecipientById } from '@/lib/mis-email/recipients';
import type { MisEmailPreferences } from '@/lib/mis-email/preferences';
import { runMisEmailDigest, runMisEmailTestBatch } from '@/lib/mis-email/run-digest';

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
        const recipient = await loadDigestRecipientById(payload.userId.trim());
        if (!recipient) {
          throw new Error(`Recipient not found: ${payload.userId}`);
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
  npx tsx src/lib/mis-email/cli.ts test [--user=<uuid>] [--to=email]
  npx tsx src/lib/mis-email/cli.ts send-user   (MIS_EMAIL_SEND_PAYLOAD=base64 json)

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
