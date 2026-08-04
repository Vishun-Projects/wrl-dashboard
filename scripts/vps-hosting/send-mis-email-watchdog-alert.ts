#!/usr/bin/env npx tsx
/**
 * Send morning MIS watchdog alert using org settings templates.
 * Called by mis-email-morning-watchdog.sh after a failed digest check.
 *
 *   MIS_EMAIL_WATCHDOG_DATE=2026-07-31 MIS_EMAIL_WATCHDOG_REASON='…' \
 *     npx tsx scripts/vps-hosting/send-mis-email-watchdog-alert.ts
 *
 * Env MIS_EMAIL_WATCHDOG_TO overrides org watchdogToEmail.
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
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });

import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import { formatWatchdogAlert } from '@/modules/mis-email/services/watchdog-alert-copy';
import { createMailTransport, resolveSmtpConfig } from '@/lib/mail/smtp';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const date =
    process.env.MIS_EMAIL_WATCHDOG_DATE?.trim() ||
    argValue('--date')?.trim() ||
    '';
  const reason =
    process.env.MIS_EMAIL_WATCHDOG_REASON?.trim() ||
    argValue('--reason')?.trim() ||
    '';
  if (!date || !reason) {
    throw new Error('Need MIS_EMAIL_WATCHDOG_DATE/--date and MIS_EMAIL_WATCHDOG_REASON/--reason');
  }

  const org = await getMisEmailOrgSettings();
  const to =
    process.env.MIS_EMAIL_WATCHDOG_TO?.trim().toLowerCase() || org.watchdogToEmail;
  const { subject, body } = formatWatchdogAlert({
    subjectTemplate: org.watchdogSubjectTemplate,
    bodyTemplate: org.watchdogBodyTemplate,
    date,
    reason,
  });

  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const info = await transport.sendMail({
    from: smtp.from,
    to,
    subject,
    text: body,
  });
  console.log(`watchdog alert mailed to ${to} messageId=${info.messageId ?? ''}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
