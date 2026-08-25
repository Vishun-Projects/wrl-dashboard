#!/usr/bin/env npx tsx
/**
 * Generic VPS ops alert mail (sync-worker health / deploy notes).
 *
 *   VPS_OPS_ALERT_TO=you@example.com \
 *   VPS_OPS_ALERT_SUBJECT='…' VPS_OPS_ALERT_BODY='…' \
 *     npx tsx scripts/vps-hosting/send-vps-ops-alert.ts
 *
 * Defaults To: SYNC_WORKER_ALERT_TO or vishunvishwakarma90211@gmail.com
 * Loads .env.mis-email (SMTP) then .env.sync-worker / .env.local.
 */
import { createRequire } from 'node:module';
import { resolve } from 'path';
import { config } from 'dotenv';

const require = createRequire(import.meta.url);
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as NodeModule;
} catch {
  /* optional */
}

const root = resolve(__dirname, '../..');
config({ path: resolve(root, '.env.mis-email'), override: true });
config({ path: resolve(root, '.env.sync-worker') });
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });

import { createMailTransport, resolveSmtpConfig } from '@/lib/mail/smtp';

const DEFAULT_TO = 'vishunvishwakarma90211@gmail.com';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const toRaw =
    process.env.VPS_OPS_ALERT_TO?.trim() ||
    process.env.SYNC_WORKER_ALERT_TO?.trim() ||
    argValue('--to')?.trim() ||
    DEFAULT_TO;
  const subject =
    process.env.VPS_OPS_ALERT_SUBJECT?.trim() ||
    argValue('--subject')?.trim() ||
    '';
  const body =
    process.env.VPS_OPS_ALERT_BODY?.trim() ||
    argValue('--body')?.trim() ||
    '';
  if (!subject || !body) {
    throw new Error('Need VPS_OPS_ALERT_SUBJECT/--subject and VPS_OPS_ALERT_BODY/--body');
  }

  const to = toRaw
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(', ');
  if (!to) throw new Error('No alert recipient');

  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const info = await transport.sendMail({
    from: smtp.from,
    to,
    subject,
    text: body,
  });
  console.log(`vps-ops alert mailed to ${to} messageId=${info.messageId ?? ''}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
