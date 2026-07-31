/**
 * Test mail relay connectivity from this machine.
 *
 *   npx tsx scripts/test-mail-relay.ts
 *   npx tsx scripts/test-mail-relay.ts --large
 *   npx tsx scripts/test-mail-relay.ts --send you@example.com
 */
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

import '@/modules/mail-alerts/services/bootstrap-env';
import {
  relayPostJson,
  resolveRelayTryUrls,
  resolveVpsMailRelaySecret,
} from '@/lib/mail/relay-client';

const LARGE = process.argv.includes('--large');
const sendTo = (() => {
  const idx = process.argv.indexOf('--send');
  return idx >= 0 ? process.argv[idx + 1]?.trim() : null;
})();

const PREPARED_PATH = '/internal/mail/mis-digest-prepared';

async function main() {
  const secret = resolveVpsMailRelaySecret();
  if (!secret) {
    console.error('VPS_MAIL_RELAY_SECRET not set in .env.local');
    process.exitCode = 1;
    return;
  }

  const urls = resolveRelayTryUrls(PREPARED_PATH);
  console.log('Relay URLs to try:', urls.join(' → '));
  console.log('NODE_ENV:', process.env.NODE_ENV ?? '(unset)');
  console.log('VPS_MAIL_RELAY_TUNNEL:', process.env.VPS_MAIL_RELAY_TUNNEL ?? '(unset)');

  const attachmentBytes = LARGE ? 1_000_000 : 0;
  const attachmentBase64 = attachmentBytes
    ? Buffer.alloc(attachmentBytes, 'x').toString('base64')
    : '';

  const payload = {
    to: sendTo || process.env.MIS_EMAIL_TEST_TO?.trim() || 'relay-test@example.com',
    subject: `Relay test ${new Date().toISOString()}`,
    html: '<p>MIS mail relay connectivity test</p>',
    text: 'MIS mail relay connectivity test',
    attachments: LARGE
      ? [
          {
            filename: 'test.bin',
            contentBase64: attachmentBase64,
            contentType: 'application/octet-stream',
          },
        ]
      : [],
  };

  if (sendTo || process.env.MIS_EMAIL_TEST_TO) {
    console.log(`Sending real test email to ${payload.to}...`);
  } else {
    console.log('Ping only (expect 200 with dry recipient or validation) — use --send email@domain.com to deliver');
  }

  const started = Date.now();
  try {
    const result = await relayPostJson<{ messageId?: string; error?: string }>(
      PREPARED_PATH,
      payload,
      secret
    );
    console.log(`OK in ${Date.now() - started}ms via ${result.url}`);
    console.log('Response:', result.data);
  } catch (err) {
    console.error(`FAILED in ${Date.now() - started}ms:`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();
