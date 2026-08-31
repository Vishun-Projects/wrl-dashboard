/**
 * Evening ops sequencer — inventory + probe mails (to ops only) + final OK/FAIL status.
 *
 *   npx tsx scripts/vps-hosting/evening-ops-sequencer.ts
 *   EVENING_OPS_TO=you@example.com EVENING_OPS_STEP_SLEEP_MS=5000 …
 *
 * Invoked by evening-ops-sequencer.sh at 16:00 IST.
 */
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
const sharedEnv = resolve(root, '../shared/.env.mis-email');
config({ path: resolve(root, '.env.mis-email'), override: true });
if (existsSync(sharedEnv)) config({ path: sharedEnv }); // fill gaps (e.g. OLD_CRM) without clobbering current
config({ path: resolve(root, '.env.sync-worker') });
config({ path: resolve(root, '../shared/.env.sync-worker') });
config({ path: resolve(root, '.env.local') });
config({ path: resolve(root, '.env') });

import { createMailTransport, resolveSmtpConfig } from '@/lib/mail/smtp';
import { VPS_CRON_CATALOG } from '@/lib/vps-cron/catalog';
import { listVpsCronJobStatus } from '@/lib/vps-cron/settings';
import { closePool } from '@/lib/read-model/db';
import { runCancelledCallDigest } from '@/modules/mis-email/services/cancelled-call-digest';
import { runMidnightCrmDeltaReport } from '@/modules/mis-email/services/midnight-crm-delta';
import { runMisEmailTestBatch } from '@/modules/mis-email/services/run-digest';
import { loadDigestRecipientById, loadDigestRecipients } from '@/modules/mis-email/services/recipients';
import { sendMisEmailComposeBatch } from '@/modules/mis-email/services/compose-digest';
import { triggerSubcontractorEmails } from '@/modules/subcontractor-stock/services/email-sender';
import {
  buildMailPipelineHealth,
  formatEveningOpsStatusMail,
  scoreEveningOpsSteps,
  scoreMidnightCronLog,
  scoreWatchdogLogForToday,
  type EveningOpsStepResult,
  type MailPipelineHealth,
} from './evening-ops-status';
import { midnightCrmDeltaSnapshotPath } from '@/modules/mis-email/services/midnight-crm-delta';

const EVENING_OPS_OPEN_ONLY_PREFS = {
  includeSummary: false,
  includeDetailed: false,
  includeKeyAccount: false,
  includeTraceableExport: false,
  includeOpenCallsExport: true,
  bodyInEmail: [
    'regional_performance',
    'branch_performance',
    'key_account_performance',
  ] as const,
} as const;

const DEFAULT_TO = 'vishnu.vishwakarma@westernequipments.com';
/** Final OK/FAIL status only — probe digests stay DEFAULT_TO. */
const DEFAULT_STATUS_CC = 'vishunvishwakarma90211@gmail.com';

function istTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sh(cmd: string, args: string[] = [], timeoutMs = 15_000): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, out: String(out).trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim();
    return { ok: false, out: out || 'command failed' };
  }
}

function hasCrlf(filePath: string): boolean {
  try {
    const buf = readFileSync(filePath);
    return buf.includes(0x0d);
  } catch {
    return false;
  }
}

function installRoot(): string {
  return process.env.MIS_EMAIL_INSTALL_ROOT?.replace(/\/current$/, '') || root.replace(/\/current$/, '');
}

function codeRoot(): string {
  const base = installRoot();
  if (existsSync(join(base, 'current', 'package.json'))) return join(base, 'current');
  return existsSync(join(root, 'package.json')) ? root : base;
}

function sharedLogs(): string {
  const base = installRoot();
  const shared = join(base, 'shared', 'logs');
  if (existsSync(shared)) return shared;
  return join(codeRoot(), 'logs');
}

function readTail(filePath: string, maxBytes = 32_000): string {
  try {
    const buf = readFileSync(filePath);
    return buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf8');
  } catch {
    return '';
  }
}

function istYesterdayYmd(today = istTodayYmd()): string {
  const [y, m, d] = today.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const prev = new Date(utc - 24 * 60 * 60 * 1000);
  return prev.toISOString().slice(0, 10);
}

function readLogOrNull(logName: string): string | null {
  const logPath = join(sharedLogs(), logName);
  if (!existsSync(logPath)) return null;
  return readTail(logPath, 256_000);
}

function watchdogStatus(logName: string, today: string): { ok: boolean; detail: string } {
  return scoreWatchdogLogForToday(today, readLogOrNull(logName), logName);
}

/** Last-night midnight job: cron complete (date on start line only) → snapshot → watchdog OK. */
function checkMidnightLastNight(code: string, today: string): { ok: boolean; detail: string } {
  const primary = scoreMidnightCronLog(today, readLogOrNull('nightly-ytd-export-cron.log'));
  if (primary.ok) return primary;

  const asOf = istYesterdayYmd(today);
  const snapCandidates = [
    midnightCrmDeltaSnapshotPath(asOf, code),
    midnightCrmDeltaSnapshotPath(asOf, installRoot()),
    join(sharedLogs(), 'crm-delta-snapshots', `${asOf}.json`),
    join(code, 'logs', 'crm-delta-snapshots', `${asOf}.json`),
  ];
  const snap = snapCandidates.find((p) => existsSync(p));
  if (snap) {
    return {
      ok: true,
      detail: `HEALED via snapshot ${asOf} (${snap}) — cron marker miss: ${primary.detail}`,
    };
  }

  const wd = scoreWatchdogLogForToday(
    today,
    readLogOrNull('midnight-crm-delta-watchdog.log'),
    'midnight-crm-delta-watchdog.log'
  );
  if (wd.ok && /OK —/i.test(wd.detail)) {
    return {
      ok: true,
      detail: `HEALED via watchdog OK — cron marker miss: ${primary.detail} | ${wd.detail}`,
    };
  }

  return {
    ok: false,
    detail: `${primary.detail} (no snapshot ${asOf}; watchdog: ${wd.detail})`,
  };
}

type Inventory = {
  today: string;
  syncWorkers: string[];
  cronLines: string[];
  systemd: string[];
  catalog: Array<{ id: string; label: string; schedule: string; script: string; paused: boolean }>;
  mailMatrix: string[];
  mailPipelines: MailPipelineHealth[];
  broken: string[];
  productionSendsToday: string[];
};

function listenPublicSmtp25(): boolean {
  const ss = sh('ss', ['-lntp']);
  if (ss.ok && /0\.0\.0\.0:25\b|\*:25\b/.test(ss.out)) return true;
  const ip = sh('hostname', ['-I'])
    .out.split(/\s+/)
    .find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x) && !x.startsWith('172.') && !x.startsWith('10.'));
  if (!ip) return false;
  return sh('bash', ['-c', `timeout 2 bash -c 'echo >/dev/tcp/${ip}/25'`]).ok;
}

function newestVendorHoursAgo(): number | null {
  const maildir = '/home/mis/Maildir';
  if (!existsSync(maildir)) return null;
  const find = sh('bash', [
    '-c',
    `grep -l -i VENDOR_STK ${maildir}/cur/* ${maildir}/new/* 2>/dev/null | while read f; do stat -c '%Y' "$f"; done | sort -rn | head -1`,
  ]);
  const ts = Number(find.out.trim());
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return (Date.now() / 1000 - ts) / 3600;
}

async function collectInventory(code: string, today: string): Promise<Inventory> {
  const broken: string[] = [];
  const syncWorkers: string[] = [];
  const systemd: string[] = [];

  syncWorkers.push(
    'Daemon: every 3 min (SYNC_INTERVAL_MS=180000) — ARCP / TE / Athena / cancelled register; calls OFF by default'
  );
  syncWorkers.push('Calls register: once daily 00:00 IST (midnight-calls-sync.sh)');
  syncWorkers.push('Nightly non-calls: ~02:30 IST (athena / attendance / user-locations / cancelled register)');
  syncWorkers.push('Health watchdog: every 15 min on failure');

  const daemon = sh('systemctl', ['is-active', 'fast-close-sync-worker']);
  syncWorkers.push(`systemctl fast-close-sync-worker: ${daemon.out || 'unknown'}`);
  if (!daemon.ok || daemon.out !== 'active') broken.push('sync-worker daemon not active');

  const timers = sh('systemctl', ['list-timers', '--all', 'fast-close-sync-worker-nightly.timer']);
  systemd.push(timers.out.slice(0, 500) || 'no nightly timer output');

  const syncLog = join(sharedLogs(), 'sync-worker.log');
  const syncTail = readTail(syncLog, 16_000);
  const callsLine = [...syncTail.split(/\r?\n/)]
    .reverse()
    .find((l) => /calls incremental=/i.test(l));
  if (callsLine) {
    syncWorkers.push(callsLine.slice(0, 180));
    if (/calls incremental=on/i.test(callsLine)) {
      broken.push('calls incremental unexpectedly ON in daemon (expected midnight-only)');
    }
  } else {
    syncWorkers.push('(no recent Daemon started line in sync-worker.log)');
  }

  const envPath = existsSync(join(installRoot(), 'shared', '.env.sync-worker'))
    ? join(installRoot(), 'shared', '.env.sync-worker')
    : join(code, '.env.sync-worker');
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, 'utf8');
    const interval = env.match(/SYNC_INTERVAL_MS=(\d+)/)?.[1];
    const calls = env.match(/SYNC_CALLS_DAEMON_ENABLED=([^\r\n]+)/)?.[1]?.trim();
    if (interval) syncWorkers.push(`SYNC_INTERVAL_MS=${interval}`);
    syncWorkers.push(`SYNC_CALLS_DAEMON_ENABLED=${calls ?? '(unset → off)'}`);
  }

  const cron = sh('crontab', ['-l']);
  const cronLines = cron.ok
    ? cron.out.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
    : [`crontab -l failed: ${cron.out}`];
  if (!cron.ok) broken.push('crontab -l failed');

  // Heal-detect: cancelled digest used to poll */15 — must not come back.
  for (const line of cronLines) {
    if (!/cancelled-call-digest\.sh/.test(line)) continue;
    broken.push(
      `cancelled-call-digest still on crontab (${line.slice(0, 80)}…) — remove poller; evening-ops covers it`
    );
  }

  for (const job of VPS_CRON_CATALOG) {
    const scriptPath = join(code, 'scripts', 'vps-hosting', job.script);
    if (!existsSync(scriptPath)) {
      broken.push(`missing script ${job.script}`);
      continue;
    }
    if (hasCrlf(scriptPath)) broken.push(`CRLF shebang risk: ${job.script}`);
  }

  let catalog: Inventory['catalog'] = [];
  try {
    catalog = await listVpsCronJobStatus();
    for (const j of catalog) {
      if (j.paused) syncWorkers.push(`PAUSED in portal: ${j.id}`);
    }
  } catch (err) {
    broken.push(`catalog status: ${err instanceof Error ? err.message : String(err)}`);
  }

  const mailMatrix = [
    'MIS morning digest | */15 Mon–Sat (prefs often 09:30) | Profile To/Cc + routing | evening: test→ops',
    'MIS test digest | often 14:00 | ops test To | evening: re-run→ops',
    'Cancelled-call digest | evening ops 16:00 only | force→ops (no */15 poller)',
    'Subcontractor SAP vs CRM | morning via stock cron | stock recipients | evening: force→ops',
    'SAP inbound mis@ | continuous (Postfix→Maildir) | extract every 15 min | live check below',
    'Midnight CRM delta | 00:15 IST (always) | configured ops | evening: log-check only',
    'Morning MIS watchdog | ~09:50 alert-on-fail | watchdog To | status only',
    'Midnight CRM watchdog | 00:30 + 02:00 alert-on-fail | watchdog To | status only',
    'Sync-worker health | every 15 min on fail | ops alert To | status only',
    'Evening ops sequencer | 16:00 IST | ops only | this run',
  ];

  const productionSendsToday: string[] = [];
  const misLog = readTail(join(sharedLogs(), 'mis-email-cron.log'), 64_000);
  for (const line of misLog.split(/\r?\n/)) {
    if (line.includes(today) && /Personal digest to |Routing digest|Digest complete — sent [1-9]/i.test(line)) {
      productionSendsToday.push(line.slice(0, 220));
    }
  }
  if (productionSendsToday.length > 12) {
    productionSendsToday.splice(0, productionSendsToday.length - 12);
  }

  const inet = sh('postconf', ['-h', 'inet_interfaces']);
  const mailPipelines = buildMailPipelineHealth({
    inetInterfaces: inet.ok ? inet.out : 'unknown',
    listenPublic25: listenPublicSmtp25(),
    newestVendorHoursAgo: newestVendorHoursAgo(),
    cronLines,
    misEmailLog: misLog || null,
    cancelledLog: readLogOrNull('cancelled-call-digest-cron.log'),
    subcontractorLog: readLogOrNull('subcontractor-stock-cron.log'),
    nightlyYtdLog: readLogOrNull('nightly-ytd-export-cron.log'),
    today,
    catalogPaused: new Set(catalog.filter((j) => j.paused).map((j) => j.id)),
  });

  for (const p of mailPipelines) {
    if (!p.ok) broken.push(`${p.label}: ${p.detail}`);
  }

  return {
    today,
    syncWorkers,
    cronLines,
    systemd,
    catalog,
    mailMatrix,
    mailPipelines,
    broken,
    productionSendsToday,
  };
}

async function runStep(
  id: string,
  label: string,
  fn: () => Promise<string>
): Promise<EveningOpsStepResult> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { id, label, ok: true, detail: detail.slice(0, 500), durationMs: Date.now() - t0 };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[evening-ops] FAIL ${id}:`, detail);
    return { id, label, ok: false, detail: detail.slice(0, 500), durationMs: Date.now() - t0 };
  }
}

async function sendStatusMail(
  to: string,
  subject: string,
  body: string,
  cc?: string
): Promise<string> {
  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const info = await transport.sendMail({
    from: smtp.from,
    to,
    ...(cc ? { cc } : {}),
    subject,
    text: body,
  });
  return String(info.messageId ?? '');
}

let statusMailed = false;

async function main(): Promise<void> {
  const to =
    process.env.EVENING_OPS_TO?.trim() ||
    process.env.VPS_OPS_ALERT_TO?.trim() ||
    DEFAULT_TO;
  const statusCc =
    process.env.EVENING_OPS_STATUS_CC?.trim() ||
    (to.toLowerCase() === DEFAULT_STATUS_CC.toLowerCase() ? '' : DEFAULT_STATUS_CC);
  const sleepMs = Math.max(0, Number(process.env.EVENING_OPS_STEP_SLEEP_MS ?? 45_000) || 0);
  const skipHeavy = process.env.EVENING_OPS_SKIP_HEAVY === '1';
  const today = istTodayYmd();
  const code = codeRoot();
  const logDir = join(sharedLogs(), 'evening-ops');
  mkdirSync(logDir, { recursive: true });

  console.log(
    `[evening-ops] start ${today} to=${to} statusCc=${statusCc || '(none)'} code=${code} sleepMs=${sleepMs}`
  );

  const steps: EveningOpsStepResult[] = [];
  const inventory = await collectInventory(code, today);

  steps.push(
    await runStep('preflight', 'Preflight paths / CRLF / env', async () => {
      const issues: string[] = [];
      const envMis = existsSync(join(code, '.env.mis-email'))
        ? join(code, '.env.mis-email')
        : join(installRoot(), 'shared', '.env.mis-email');
      if (!existsSync(envMis)) issues.push('missing .env.mis-email');
      if (!process.env.OLD_CRM_DATABASE_URL?.trim()) {
        issues.push('OLD_CRM_DATABASE_URL unset (SAP vs CRM / subcontractor stock needs old_crm)');
      }
      const cli = join(code, 'src', 'modules', 'mis-email', 'services', 'cli.ts');
      if (!existsSync(cli)) issues.push('missing cli.ts');
      for (const script of [
        'evening-ops-sequencer.sh',
        'mis-email-test-digest.sh',
        'nightly-ytd-calls-export.sh',
        'vps-cron-gate.sh',
      ]) {
        const p = join(code, 'scripts', 'vps-hosting', script);
        if (!existsSync(p)) issues.push(`missing ${script}`);
        else if (hasCrlf(p)) issues.push(`CRLF ${script}`);
      }
      // Smoke: tsx can resolve digest CLI without PageShell crash
      const smoke = spawnSync(
        'npx',
        ['tsx', 'src/modules/mis-email/services/cli.ts', 'help'],
        { cwd: code, encoding: 'utf8', timeout: 60_000, env: process.env }
      );
      if (smoke.status !== 0) {
        issues.push(`cli help failed: ${(smoke.stderr || smoke.stdout || '').slice(0, 200)}`);
      }
      if (issues.length) throw new Error(issues.join('; '));
      return 'env + scripts + cli help ok';
    })
  );

  for (const [id, logName, label] of [
    ['wd_mis', 'mis-email-watchdog.log', 'Morning MIS watchdog'],
    ['wd_midnight', 'midnight-crm-delta-watchdog.log', 'Midnight CRM watchdog'],
    ['wd_sync', 'sync-worker-health-watchdog.log', 'Sync-worker health watchdog'],
  ] as const) {
    steps.push(
      await runStep(id, label, async () => {
        const st = watchdogStatus(logName, today);
        if (!st.ok) throw new Error(st.detail);
        return st.detail;
      })
    );
  }

  if (inventory.broken.length) {
    steps.push({
      id: 'inventory_broken',
      label: 'Inventory broken markers',
      ok: false,
      detail: inventory.broken.join('; ').slice(0, 500),
    });
  } else {
    steps.push({
      id: 'inventory_broken',
      label: 'Inventory broken markers',
      ok: true,
      detail: 'none',
    });
  }

  const afterProbe = async () => {
    if (sleepMs > 0) {
      console.log(`[evening-ops] sleep ${sleepMs}ms before next mail…`);
      await sleep(sleepMs);
    }
  };

  steps.push(
    await runStep('mis_test', 'MIS daily test digest (cron-style, open-only)', async () => {
      const results = await runMisEmailTestBatch({
        recipientOverride: to,
        attachmentProfile: 'open_only',
      });
      const sent = results.map((r) => r.sentTo).join(', ');
      return `sent ${results.length} → ${sent}`;
    })
  );
  await afterProbe();

  steps.push(
    await runStep('mis_compose', 'MIS compose-style send (UI path, open-only)', async () => {
      const recipients = await loadDigestRecipients();
      const self =
        recipients.find((r) => r.email.toLowerCase() === to.toLowerCase()) ||
        recipients[0];
      if (!self) {
        const byId = process.env.EVENING_OPS_COMPOSE_USER_ID?.trim();
        if (!byId) throw new Error('no digest recipient for compose probe');
        const r = await loadDigestRecipientById(byId);
        if (!r) throw new Error(`compose user not found: ${byId}`);
        const results = await sendMisEmailComposeBatch(
          { ...r, includeSummary: true },
          {
            sendTo: [to],
            displayName: r.name,
            preferences: { ...r.mis_email_preferences, ...EVENING_OPS_OPEN_ONLY_PREFS },
          }
        );
        return `compose ${results.length} → ${results.map((x) => x.sentTo).join(', ')}`;
      }
      const results = await sendMisEmailComposeBatch(
        { ...self, includeSummary: true },
        {
          sendTo: [to],
          displayName: self.name,
          preferences: { ...self.mis_email_preferences, ...EVENING_OPS_OPEN_ONLY_PREFS },
        }
      );
      return `compose ${results.length} → ${results.map((x) => x.sentTo).join(', ')}`;
    })
  );
  await afterProbe();

  steps.push(
    await runStep('cancelled', 'Cancelled-call digest (force→ops)', async () => {
      const result = await runCancelledCallDigest({ force: true, forceTo: to });
      if (result.failed.length) {
        throw new Error(result.failed.map((f) => `${f.branch}:${f.error}`).join('; '));
      }
      return `${result.digestDate} sent=${result.sent.length} skipped=${result.skipped.length}`;
    })
  );
  await afterProbe();

  steps.push(
    await runStep('sap_crm', 'Subcontractor SAP vs CRM (force→ops)', async () => {
      try {
        const result = await triggerSubcontractorEmails({ force: true, forceTo: to });
        return `sentCount=${result.sentCount}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // No SAP extract yet today — probe cannot invent stock; not a mail-pipeline failure.
        if (/No HTML files found for today/i.test(msg) || /SAP extracted directory not found/i.test(msg)) {
          return `SKIP — ${msg.slice(0, 200)}`;
        }
        throw err;
      }
    })
  );
  await afterProbe();

  // Full midnight CRM delta recompute OOMs the VPS (exit 137) when stacked after MIS.
  // Default: verify last night's 00:00 job (start has date; complete does not). Optional full resend.
  if (skipHeavy) {
    steps.push({
      id: 'midnight_delta',
      label: 'Midnight CRM delta (last-night check)',
      ok: true,
      detail: 'skipped (EVENING_OPS_SKIP_HEAVY=1)',
    });
  } else if (process.env.EVENING_OPS_MIDNIGHT_RESEND === '1') {
    steps.push(
      await runStep('midnight_delta', 'Midnight CRM delta report→ops (full resend)', async () => {
        const result = await runMidnightCrmDeltaReport({ to });
        return `asOf=${result.dateRange.endDate} rows=${result.exportRows} messageId=${result.messageId}`;
      })
    );
  } else {
    steps.push(
      await runStep('midnight_delta', 'Midnight CRM delta (last-night check)', async () => {
        const st = checkMidnightLastNight(code, today);
        if (!st.ok) throw new Error(st.detail);
        return st.detail;
      })
    );
  }

  const score = scoreEveningOpsSteps(steps);
  const body = formatEveningOpsStatusMail({
    scoreOk: score.ok,
    summaryLine: score.summaryLine,
    today,
    inventory,
    steps,
  });

  const outJson = join(logDir, `${today}.json`);
  writeFileSync(
    outJson,
    JSON.stringify({ today, to, score, inventory, steps }, null, 2)
  );
  writeFileSync(join(logDir, `${today}.txt`), body);

  // Subject names the break so inbox skim works without opening the body.
  const subject = score.ok
    ? `Evening ops ALL GOOD — ${today}`
    : `Evening ops ATTENTION — ${score.failedIds.join(', ')} — ${today}`;
  const messageId = await sendStatusMail(to, subject, body, statusCc || undefined);
  statusMailed = true;
  console.log(
    `[evening-ops] status mailed to ${to}${statusCc ? ` cc=${statusCc}` : ''} messageId=${messageId}`
  );
  console.log(`[evening-ops] ${score.summaryLine}`);
  console.log(`[evening-ops] wrote ${outJson}`);

  if (!score.ok) process.exitCode = 1;
}

main()
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exitCode = 1;
    if (statusMailed) return;
    try {
      const to =
        process.env.EVENING_OPS_TO?.trim() ||
        process.env.VPS_OPS_ALERT_TO?.trim() ||
        DEFAULT_TO;
      const statusCc =
        process.env.EVENING_OPS_STATUS_CC?.trim() ||
        (to.toLowerCase() === DEFAULT_STATUS_CC.toLowerCase() ? '' : DEFAULT_STATUS_CC);
      const today = istTodayYmd();
      await sendStatusMail(
        to,
        `Evening ops STATUS CRASH — ${today}`,
        `Evening ops crashed before normal STATUS mail.\n\n${msg}\n`,
        statusCc || undefined
      );
      console.log('[evening-ops] emergency STATUS CRASH mailed');
    } catch (mailErr) {
      console.error(
        '[evening-ops] emergency status mail failed',
        mailErr instanceof Error ? mailErr.message : mailErr
      );
    }
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      /* ignore */
    }
  });
