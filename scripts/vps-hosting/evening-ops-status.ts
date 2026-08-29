/**
 * Pure scoring + status copy for evening ops sequencer (no I/O).
 * Self-check: npx tsx scripts/vps-hosting/evening-ops-status.check.ts
 */

export type EveningOpsStepResult = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
};

export type EveningOpsScore = {
  ok: boolean;
  failedIds: string[];
  summaryLine: string;
};

export function scoreEveningOpsSteps(steps: EveningOpsStepResult[]): EveningOpsScore {
  const failed = steps.filter((s) => !s.ok);
  const ok = failed.length === 0;
  return {
    ok,
    failedIds: failed.map((s) => s.id),
    summaryLine: ok
      ? `OK — ${steps.length} step(s) passed`
      : `FAIL — ${failed.length}/${steps.length} failed: ${failed.map((s) => s.id).join(', ')}`,
  };
}

/** FAIL only on today's FAIL/ALERT without a later OK — missing/stale logs are not FAIL. */
export function scoreWatchdogLogForToday(
  today: string,
  logText: string | null,
  logName: string
): { ok: boolean; detail: string } {
  if (logText == null) {
    return { ok: true, detail: `missing log ${logName} (not FAIL — watchdog may be absent)` };
  }
  const todayLines = logText.split(/\r?\n/).filter((l) => l.includes(today));
  if (!todayLines.length) {
    return { ok: true, detail: `no ${today} lines in ${logName}` };
  }
  let lastFail = -1;
  let lastOk = -1;
  for (let i = 0; i < todayLines.length; i++) {
    const line = todayLines[i];
    if (/FAIL|ALERT|FATAL/i.test(line)) lastFail = i;
    if (/\[.*\] OK|OK —/i.test(line)) lastOk = i;
  }
  if (lastFail >= 0 && lastFail > lastOk) {
    return { ok: false, detail: todayLines[lastFail].slice(0, 200) };
  }
  return { ok: true, detail: todayLines[todayLines.length - 1].slice(0, 200) };
}

export type MidnightCronScore = {
  ok: boolean;
  detail: string;
  /** sync_ok | mail_ok | both | neither | unknown */
  sync: 'ok' | 'fail' | 'missing' | 'unknown';
  mail: 'ok' | 'fail' | 'missing' | 'unknown';
};

/**
 * New layout (from 2026-08-27):
 *   00:00  === midnight-crm-delta sync-only DATE ===
 *   00:15  === midnight-crm-delta mail DATE === … === midnight-crm-delta complete ===
 *
 * Evening check cares most about MAIL complete. Sync FATAL alone is not enough to FAIL
 * if mail completed later (mail is intentionally always-send).
 */
export function scoreMidnightCronLog(
  today: string,
  logText: string | null
): MidnightCronScore {
  if (logText == null || !logText.trim()) {
    return {
      ok: false,
      detail: 'missing nightly-ytd-export-cron.log',
      sync: 'missing',
      mail: 'missing',
    };
  }
  const lines = logText.split(/\r?\n/);

  let lastSyncStart = -1;
  let lastMailStart = -1;
  let lastLegacyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(today)) continue;
    if (/midnight-crm-delta sync-only\s+20\d{2}-/.test(line)) lastSyncStart = i;
    else if (/midnight-crm-delta mail\s+20\d{2}-/.test(line)) lastMailStart = i;
    else if (/midnight-crm-delta\s+20\d{2}-/.test(line)) lastLegacyStart = i;
  }

  let sync: MidnightCronScore['sync'] = 'missing';
  let mail: MidnightCronScore['mail'] = 'missing';

  const scanAfter = (start: number, untilNextStart: (line: string) => boolean) => {
    let fatal: string | null = null;
    let complete = false;
    let syncOk = false;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (untilNextStart(line)) break;
      if (/FATAL:\s*midnight/i.test(line)) fatal = line;
      if (/midnight calls sync ok/i.test(line)) syncOk = true;
      if (/midnight-crm-delta complete/i.test(line)) complete = true;
    }
    return { fatal, complete, syncOk };
  };

  const isJobStart = (line: string) =>
    /midnight-crm-delta (sync-only|mail)\s+20\d{2}-/.test(line) ||
    /=== midnight-crm-delta 20\d{2}-/.test(line);

  if (lastSyncStart >= 0) {
    const r = scanAfter(lastSyncStart, isJobStart);
    sync = r.fatal && !r.syncOk ? 'fail' : r.syncOk ? 'ok' : r.fatal ? 'fail' : 'unknown';
  }
  if (lastMailStart >= 0) {
    const r = scanAfter(lastMailStart, isJobStart);
    mail = r.complete ? 'ok' : r.fatal ? 'fail' : 'unknown';
  }

  // Legacy single job (pre-split): one start, complete or FATAL.
  if (lastMailStart < 0 && lastSyncStart < 0 && lastLegacyStart >= 0) {
    const r = scanAfter(lastLegacyStart, (line) => /midnight-crm-delta\s+20\d{2}-/.test(line));
    if (r.complete) {
      return {
        ok: true,
        detail: 'legacy midnight job completed',
        sync: 'ok',
        mail: 'ok',
      };
    }
    return {
      ok: false,
      detail: r.fatal?.slice(0, 220) || 'legacy midnight job started but no complete marker',
      sync: r.fatal ? 'fail' : 'unknown',
      mail: 'missing',
    };
  }

  if (mail === 'ok') {
    return {
      ok: true,
      detail:
        sync === 'fail'
          ? '00:15 CRM delta MAIL ok (00:00 sync had FATAL — mail still sent by design)'
          : sync === 'ok'
            ? '00:00 sync ok + 00:15 CRM delta mail ok'
            : '00:15 CRM delta MAIL ok',
      sync,
      mail,
    };
  }

  if (mail === 'fail') {
    return {
      ok: false,
      detail: '00:15 CRM delta MAIL failed — you did not get last night’s midnight delta report',
      sync,
      mail,
    };
  }

  if (sync === 'fail' && mail === 'missing') {
    return {
      ok: false,
      detail:
        '00:00 calls sync FATAL and no 00:15 mail marker yet — midnight delta report likely missing',
      sync,
      mail,
    };
  }

  if (lastSyncStart < 0 && lastMailStart < 0) {
    return {
      ok: false,
      detail: `no midnight sync/mail start lines for ${today} in nightly-ytd-export-cron.log`,
      sync: 'missing',
      mail: 'missing',
    };
  }

  return {
    ok: false,
    detail: `midnight incomplete (sync=${sync}, mail=${mail}) — no 'midnight-crm-delta complete' for ${today}`,
    sync,
    mail,
  };
}

/** Live WORKING / BROKEN for each automated mail path (inventory + status mail). */
export type MailPipelineHealth = {
  id: string;
  label: string;
  /** false → evening ops inventory FAIL */
  ok: boolean;
  status: 'WORKING' | 'BROKEN' | 'WARN';
  detail: string;
};

export function scorePostfixInbound(params: {
  inetInterfaces: string;
  listenPublic25: boolean;
}): MailPipelineHealth {
  const loopbackOnly = /loopback-only/i.test(params.inetInterfaces);
  if (loopbackOnly || !params.listenPublic25) {
    return {
      id: 'inbound_mis_maildir',
      label: 'Inbound mis@ → Maildir (SAP / any mail)',
      ok: false,
      status: 'BROKEN',
      detail: loopbackOnly
        ? 'Postfix inet_interfaces=loopback-only — public :25 refuses mail; Maildir will not get new SAP/hi'
        : 'Postfix not listening on public :25 — inbound mail cannot land in /home/mis/Maildir',
    };
  }
  return {
    id: 'inbound_mis_maildir',
    label: 'Inbound mis@ → Maildir (SAP / any mail)',
    ok: true,
    status: 'WORKING',
    detail: 'Postfix accepts public :25 for local domains → /home/mis/Maildir',
  };
}

/** Newest VENDOR_STK / Maildir message age (hours). null = none found. */
export function scoreSapMaildirFreshness(params: {
  newestVendorHoursAgo: number | null;
  /** Soft warn if older than this (default 36h — weekend gap OK as WARN not FAIL). */
  warnAfterHours?: number;
}): MailPipelineHealth {
  const warnAfter = params.warnAfterHours ?? 36;
  if (params.newestVendorHoursAgo == null) {
    return {
      id: 'sap_maildir_fresh',
      label: 'SAP VENDOR_STK in mis Maildir',
      ok: true,
      status: 'WARN',
      detail: 'No VENDOR_STK messages found in Maildir (inbound may be empty — check Roundcube)',
    };
  }
  if (params.newestVendorHoursAgo > warnAfter) {
    return {
      id: 'sap_maildir_fresh',
      label: 'SAP VENDOR_STK in mis Maildir',
      ok: true,
      status: 'WARN',
      detail: `Newest VENDOR_STK ~${Math.round(params.newestVendorHoursAgo)}h ago (stale vs ${warnAfter}h) — inbound path OK but no recent SAP drop`,
    };
  }
  return {
    id: 'sap_maildir_fresh',
    label: 'SAP VENDOR_STK in mis Maildir',
    ok: true,
    status: 'WORKING',
    detail: `Newest VENDOR_STK ~${Math.round(params.newestVendorHoursAgo)}h ago`,
  };
}

export function scoreCronLinePresent(params: {
  id: string;
  label: string;
  cronLines: string[];
  needles: RegExp[];
  /** All needles must match some line (default) vs any one. */
  requireAll?: boolean;
}): MailPipelineHealth {
  const requireAll = params.requireAll !== false;
  const hits = params.needles.map((re) => params.cronLines.some((l) => re.test(l)));
  const ok = requireAll ? hits.every(Boolean) : hits.some(Boolean);
  if (!ok) {
    return {
      id: params.id,
      label: params.label,
      ok: false,
      status: 'BROKEN',
      detail: `crontab missing: ${params.needles.map((r) => r.source).join(' + ')}`,
    };
  }
  return {
    id: params.id,
    label: params.label,
    ok: true,
    status: 'WORKING',
    detail: 'crontab line present',
  };
}

export function scoreCronLogRecent(params: {
  id: string;
  label: string;
  logText: string | null;
  today: string;
  /** If cron present but log silent today → WARN (not FAIL). */
}): MailPipelineHealth {
  if (params.logText == null) {
    return {
      id: params.id,
      label: params.label,
      ok: true,
      status: 'WARN',
      detail: 'log missing (cron may never have run)',
    };
  }
  if (!params.logText.includes(params.today)) {
    return {
      id: params.id,
      label: params.label,
      ok: true,
      status: 'WARN',
      detail: `no ${params.today} lines in log — cron may be stuck/paused`,
    };
  }
  return {
    id: params.id,
    label: params.label,
    ok: true,
    status: 'WORKING',
    detail: `log has ${params.today} activity`,
  };
}

export function buildMailPipelineHealth(params: {
  inetInterfaces: string;
  listenPublic25: boolean;
  newestVendorHoursAgo: number | null;
  cronLines: string[];
  misEmailLog: string | null;
  cancelledLog: string | null;
  subcontractorLog: string | null;
  nightlyYtdLog: string | null;
  today: string;
  catalogPaused: Set<string>;
}): MailPipelineHealth[] {
  const pipes: MailPipelineHealth[] = [];

  pipes.push(
    scorePostfixInbound({
      inetInterfaces: params.inetInterfaces,
      listenPublic25: params.listenPublic25,
    })
  );
  pipes.push(scoreSapMaildirFreshness({ newestVendorHoursAgo: params.newestVendorHoursAgo }));

  const cronMis = scoreCronLinePresent({
    id: 'cron_mis_digest',
    label: 'MIS digest cron',
    cronLines: params.cronLines,
    needles: [/mis-email-digest\.sh/],
  });
  pipes.push(
    params.catalogPaused.has('mis_email_digest')
      ? {
          ...cronMis,
          ok: true,
          status: 'WARN',
          detail: 'PAUSED in portal',
        }
      : cronMis
  );
  pipes.push(
    scoreCronLogRecent({
      id: 'mis_digest_log',
      label: 'MIS digest log today',
      logText: params.misEmailLog,
      today: params.today,
    })
  );

  pipes.push(
    scoreCronLinePresent({
      id: 'cron_mis_test',
      label: 'MIS test digest cron',
      cronLines: params.cronLines,
      needles: [/mis-email-test-digest\.sh/],
    })
  );

  const cronCancel = scoreCronLinePresent({
    id: 'cron_cancelled',
    label: 'Cancelled-call digest cron',
    cronLines: params.cronLines,
    needles: [/cancelled-call-digest\.sh/],
  });
  // Standalone */15 poller removed — evening-ops covers the ops probe.
  if (!cronCancel.ok && params.cronLines.some((l) => /evening-ops-sequencer\.sh/.test(l))) {
    pipes.push({
      id: 'cron_cancelled',
      label: 'Cancelled-call digest',
      ok: true,
      status: 'WORKING',
      detail: 'no standalone cron (by design) — covered by evening-ops 16:00 force→ops',
    });
  } else if (params.catalogPaused.has('cancelled_call_digest')) {
    pipes.push({ ...cronCancel, ok: true, status: 'WARN', detail: 'PAUSED in portal' });
  } else {
    pipes.push(cronCancel);
  }
  pipes.push(
    scoreCronLogRecent({
      id: 'cancelled_log',
      label: 'Cancelled-call digest log today',
      logText: params.cancelledLog,
      today: params.today,
    })
  );

  const cronSap = scoreCronLinePresent({
    id: 'cron_sap_stock',
    label: 'Subcontractor SAP vs CRM cron',
    cronLines: params.cronLines,
    needles: [/subcontractor-stock-cron\.sh/],
  });
  pipes.push(
    params.catalogPaused.has('subcontractor_stock')
      ? { ...cronSap, ok: true, status: 'WARN', detail: 'PAUSED in portal' }
      : cronSap
  );
  pipes.push(
    scoreCronLogRecent({
      id: 'sap_stock_log',
      label: 'Subcontractor stock cron log today',
      logText: params.subcontractorLog,
      today: params.today,
    })
  );

  pipes.push(
    scoreCronLinePresent({
      id: 'cron_midnight_sync',
      label: 'Midnight calls sync cron (00:00)',
      cronLines: params.cronLines,
      needles: [/nightly-ytd-calls-export\.sh/],
    })
  );
  pipes.push(
    scoreCronLinePresent({
      id: 'cron_midnight_mail',
      label: 'Midnight CRM delta mail cron (00:15)',
      cronLines: params.cronLines,
      needles: [/midnight-crm-delta-mail\.sh/],
    })
  );
  pipes.push(
    scoreCronLogRecent({
      id: 'midnight_log',
      label: 'Midnight YTD/CRM cron log today',
      logText: params.nightlyYtdLog,
      today: params.today,
    })
  );

  pipes.push(
    scoreCronLinePresent({
      id: 'cron_evening_ops',
      label: 'Evening ops sequencer cron',
      cronLines: params.cronLines,
      needles: [/evening-ops-sequencer\.sh/],
    })
  );

  return pipes;
}

/** Human “what broke / what to do” blurb for the status mail. */
export function explainFailedStep(step: EveningOpsStepResult): {
  plain: string;
  action: string;
} {
  switch (step.id) {
    case 'midnight_delta':
      if (/00:15 CRM delta MAIL failed/i.test(step.detail)) {
        return {
          plain: 'Last night’s 00:15 CRM delta report mail failed.',
          action: 'Open nightly-ytd-export-cron.log around 00:15; re-send with EVENING_OPS_MIDNIGHT_RESEND=1 if needed.',
        };
      }
      if (/no midnight sync\/mail start/i.test(step.detail)) {
        return {
          plain: 'No midnight sync/mail ran today (cron may be missing or did not fire).',
          action: 'Confirm crontab has 0 0 (sync) and 15 0 (mail); run: npm run mis-email:install-nightly-ytd-export-cron:vps',
        };
      }
      return {
        plain: 'Last night’s midnight calls sync / CRM delta did not finish cleanly.',
        action:
          'Check shared/logs/nightly-ytd-export-cron.log for 00:00 sync + 00:15 mail. Tonight 00:15 should still mail even if sync fails.',
      };
    case 'preflight':
      return {
        plain: 'VPS paths / env / scripts failed preflight (missing file, CRLF, or CLI crash).',
        action: 'Fix the listed path/CRLF/cli error on current/ before trusting other mail jobs.',
      };
    case 'inventory_broken':
      return {
        plain: 'Inventory found something broken (daemon, CRLF script, bad cron path, inbound mail, etc.).',
        action: 'See MAIL PIPELINES — LIVE and Broken / warnings in this mail; fix BROKEN items first.',
      };
    case 'sap_crm':
      if (/OLD_CRM_DATABASE_URL/i.test(step.detail)) {
        return {
          plain: 'SAP vs CRM could not query old_crm — OLD_CRM_DATABASE_URL missing in VPS env.',
          action:
            'Put OLD_CRM_DATABASE_URL in shared/.env.mis-email (same host as DATABASE_URL, db=old_crm). Stock cron needs it too.',
        };
      }
      return {
        plain: 'Subcontractor SAP vs CRM probe failed (not a soft skip).',
        action: 'Check /tmp/extracted_sap and subcontractor stock cron / relay.',
      };
    case 'mis_test':
    case 'mis_compose':
      return {
        plain: 'MIS probe mail failed to send.',
        action: 'Check mis-email SMTP / cli logs; confirm To override reached you.',
      };
    case 'cancelled':
      return {
        plain: 'Cancelled-call digest probe failed.',
        action: 'Check cancelled-call-digest logs and forceTo path.',
      };
    default:
      if (step.id.startsWith('wd_')) {
        return {
          plain: `Watchdog ${step.id} reported a problem for today.`,
          action: 'Read the matching *-watchdog.log for today’s FAIL line.',
        };
      }
      return {
        plain: step.label + ' failed.',
        action: 'See step detail below.',
      };
  }
}

export function formatEveningOpsStatusMail(params: {
  today: string;
  scoreOk: boolean;
  summaryLine: string;
  steps: EveningOpsStepResult[];
  inventory: {
    syncWorkers: string[];
    cronLines: string[];
    systemd: string[];
    catalog: Array<{ id: string; label: string; schedule: string; script: string; paused: boolean }>;
    mailMatrix: string[];
    mailPipelines: MailPipelineHealth[];
    broken: string[];
    productionSendsToday: string[];
  };
}): string {
  const failed = params.steps.filter((s) => !s.ok);
  const okSteps = params.steps.filter((s) => s.ok);
  const lines: string[] = [];
  const pipes = params.inventory.mailPipelines ?? [];
  const pipeBroken = pipes.filter((p) => !p.ok);
  const pipeWarn = pipes.filter((p) => p.ok && p.status === 'WARN');

  lines.push('════════════════════════════════════════');
  lines.push(`EVENING OPS STATUS — ${params.scoreOk ? 'ALL GOOD' : 'ATTENTION NEEDED'}`);
  lines.push(`${params.today} IST`);
  lines.push('════════════════════════════════════════');
  lines.push('');
  lines.push(params.summaryLine);
  lines.push('');

  lines.push('MAIL PIPELINES — LIVE');
  lines.push('─────────────────────');
  if (!pipes.length) {
    lines.push('(no pipeline checks)');
  } else {
    for (const p of pipes) {
      const mark = p.status === 'WORKING' ? 'WORKING' : p.status === 'WARN' ? 'WARN   ' : 'BROKEN ';
      lines.push(`${mark}  ${p.label}`);
      lines.push(`         ${p.detail}`);
    }
  }
  if (pipeBroken.length) {
    lines.push('');
    lines.push(`→ ${pipeBroken.length} pipeline(s) BROKEN — new mail may not land / cron missing.`);
  } else if (pipeWarn.length) {
    lines.push('');
    lines.push(`→ ${pipeWarn.length} WARN (stale/silent today) — not FAIL by itself.`);
  }
  lines.push('');

  if (failed.length) {
    lines.push(`WHAT BROKE (${failed.length})`);
    lines.push('──────────');
    failed.forEach((s, i) => {
      const exp = explainFailedStep(s);
      lines.push(`${i + 1}. ${s.label} [${s.id}]`);
      lines.push(`   Meaning: ${exp.plain}`);
      lines.push(`   Do this: ${exp.action}`);
      lines.push(`   Log: ${s.detail.slice(0, 280)}`);
      lines.push('');
    });
  } else {
    lines.push('WHAT BROKE');
    lines.push('──────────');
    lines.push('Nothing. All checklist steps passed.');
    lines.push('');
  }

  lines.push('WHAT’S FINE');
  lines.push('──────────');
  if (!okSteps.length) {
    lines.push('(none)');
  } else {
    for (const s of okSteps) {
      const short = s.detail.length > 120 ? `${s.detail.slice(0, 117)}…` : s.detail;
      lines.push(`✓ ${s.label}: ${short}`);
    }
  }
  lines.push('');

  if (params.inventory.broken.length) {
    lines.push('INVENTORY WARNINGS');
    lines.push('──────────────────');
    for (const b of params.inventory.broken) lines.push(`! ${b}`);
    lines.push('');
  }

  lines.push('QUICK SCHEDULE');
  lines.push('──────────────');
  lines.push('• Calls → hot: 00:00 IST (through yesterday only)');
  lines.push('• Midnight CRM delta mail: 00:15 IST (always, even if sync failed)');
  lines.push('• Sync daemon: every 3 min (calls OFF daytime)');
  lines.push('• SAP inbound: mis@mail.wrl-fsm.cloud → /home/mis/Maildir → extract → stock');
  lines.push('• This checklist: 16:00 IST → you only');
  lines.push('');

  lines.push('── Full dump (optional) ──');
  lines.push('');
  lines.push('=== Sync workers ===');
  for (const s of params.inventory.syncWorkers) lines.push(`- ${s}`);
  lines.push('');
  lines.push('=== Systemd ===');
  for (const s of params.inventory.systemd) lines.push(s);
  lines.push('');
  lines.push('=== Crontab ===');
  for (const c of params.inventory.cronLines) lines.push(c);
  lines.push('');
  lines.push('=== Catalog / pause ===');
  for (const j of params.inventory.catalog) {
    lines.push(`${j.paused ? 'PAUSED' : 'RUN   '} ${j.id} | ${j.schedule}`);
  }
  lines.push('');
  lines.push('=== Mail matrix (schedule) ===');
  for (const m of params.inventory.mailMatrix) lines.push(`- ${m}`);
  lines.push('');
  lines.push('=== Production MIS sends (log tail) ===');
  if (!params.inventory.productionSendsToday.length) lines.push('(none in mis-email-cron.log tail)');
  else for (const p of params.inventory.productionSendsToday) lines.push(`- ${p}`);
  lines.push('');
  lines.push('=== Raw step results ===');
  for (const s of params.steps) {
    lines.push(
      `${s.ok ? 'OK  ' : 'FAIL'} ${s.id} (${s.durationMs ?? 0}ms) — ${s.label}: ${s.detail}`
    );
  }
  return lines.join('\n');
}
