import assert from 'node:assert/strict';
import {
  buildMailPipelineHealth,
  explainFailedStep,
  formatEveningOpsStatusMail,
  scoreEveningOpsSteps,
  scoreMidnightCronLog,
  scorePostfixInbound,
  scoreWatchdogLogForToday,
  type EveningOpsStepResult,
} from './evening-ops-status';

const allOk: EveningOpsStepResult[] = [
  { id: 'preflight', label: 'Preflight', ok: true, detail: 'ok' },
  { id: 'mis_test', label: 'MIS test', ok: true, detail: 'sent' },
];
const scoredOk = scoreEveningOpsSteps(allOk);
assert.equal(scoredOk.ok, true);
assert.deepEqual(scoredOk.failedIds, []);
assert.match(scoredOk.summaryLine, /^OK/);

const withFail: EveningOpsStepResult[] = [
  ...allOk,
  { id: 'cancelled', label: 'Cancelled', ok: false, detail: 'boom' },
];
const scoredFail = scoreEveningOpsSteps(withFail);
assert.equal(scoredFail.ok, false);
assert.deepEqual(scoredFail.failedIds, ['cancelled']);
assert.match(scoredFail.summaryLine, /^FAIL/);

assert.equal(scoreWatchdogLogForToday('2026-08-27', null, 'x.log').ok, true);
assert.equal(
  scoreWatchdogLogForToday(
    '2026-08-27',
    '[2026-08-25T11:30:01] FAIL — daemon dead\n[2026-08-25T12:00:00] OK — recovered',
    'x.log'
  ).ok,
  true,
  'stale FAIL from another day must not fail today'
);
assert.equal(
  scoreWatchdogLogForToday(
    '2026-08-27',
    '[2026-08-27T09:50:01] FAIL — morning digest missing',
    'x.log'
  ).ok,
  false
);
assert.equal(
  scoreWatchdogLogForToday(
    '2026-08-27',
    '[2026-08-27T09:50:01] FAIL — morning digest missing\n[2026-08-27T10:00:00] OK — recovered',
    'x.log'
  ).ok,
  true
);

const midnightLegacy = [
  '=== midnight-crm-delta 2026-08-26T00:00:01+05:30 ===',
  '=== midnight-crm-delta complete ===',
  '=== midnight-crm-delta 2026-08-27T00:00:02+05:30 ===',
  '=== midnight calls sync ok ===',
  '=== midnight-crm-delta complete ===',
].join('\n');
assert.equal(scoreMidnightCronLog('2026-08-27', midnightLegacy).ok, true);
assert.equal(scoreMidnightCronLog('2026-08-27', null).ok, false);
assert.equal(
  scoreMidnightCronLog(
    '2026-08-27',
    '=== midnight-crm-delta 2026-08-27T00:00:02+05:30 ===\nFATAL: midnight calls sync failed'
  ).ok,
  false
);
assert.equal(
  scoreMidnightCronLog(
    '2026-08-27',
    '=== midnight-crm-delta 2026-08-27T00:00:02+05:30 ===\n=== midnight calls sync ok ==='
  ).ok,
  false,
  'legacy start without complete is FAIL'
);

const splitOk = [
  '=== midnight-crm-delta sync-only 2026-08-27T00:00:01+05:30 ===',
  'FATAL: midnight calls sync failed — mail job at 00:15 will still run',
  '=== midnight-crm-delta mail 2026-08-27T00:15:01+05:30 ===',
  '=== midnight-crm-delta complete ===',
].join('\n');
const splitScored = scoreMidnightCronLog('2026-08-27', splitOk);
assert.equal(splitScored.ok, true);
assert.equal(splitScored.sync, 'fail');
assert.equal(splitScored.mail, 'ok');

assert.equal(scoreMidnightCronLog(
  '2026-08-27',
  [
    '=== midnight-crm-delta sync-only 2026-08-27T00:00:01+05:30 ===',
    '=== midnight calls sync ok ===',
    '=== midnight-crm-delta mail 2026-08-27T00:15:01+05:30 ===',
    '=== midnight-crm-delta complete ===',
  ].join('\n')
).ok, true);

assert.equal(
  scoreMidnightCronLog(
    '2026-08-27',
    [
      '=== midnight-crm-delta sync-only 2026-08-27T00:00:01+05:30 ===',
      'FATAL: midnight calls sync failed — mail job at 00:15 will still run',
    ].join('\n')
  ).ok,
  false
);

assert.equal(scorePostfixInbound({ inetInterfaces: 'loopback-only', listenPublic25: false }).ok, false);
assert.equal(scorePostfixInbound({ inetInterfaces: 'all', listenPublic25: true }).ok, true);

const pipes = buildMailPipelineHealth({
  inetInterfaces: 'all',
  listenPublic25: true,
  newestVendorHoursAgo: 5,
  cronLines: [
    '*/15 * * * * /x/mis-email-digest.sh',
    '0 14 * * * /x/mis-email-test-digest.sh',
    '*/15 * * * * /x/cancelled-call-digest.sh',
    '*/15 * * * * /x/subcontractor-stock-cron.sh',
    '0 0 * * * /x/nightly-ytd-calls-export.sh',
    '15 0 * * * /x/midnight-crm-delta-mail.sh',
    '0 16 * * * /x/evening-ops-sequencer.sh',
  ],
  misEmailLog: '2026-08-27 Digest complete — sent 1',
  cancelledLog: '2026-08-27 complete',
  subcontractorLog: '2026-08-27 subcontractor-stock-cron start',
  nightlyYtdLog: '2026-08-27 midnight-crm-delta',
  today: '2026-08-27',
  catalogPaused: new Set(),
});
assert.ok(pipes.every((p) => p.ok));
assert.ok(pipes.some((p) => p.id === 'inbound_mis_maildir' && p.status === 'WORKING'));

const brokenInbound = buildMailPipelineHealth({
  inetInterfaces: 'loopback-only',
  listenPublic25: false,
  newestVendorHoursAgo: null,
  cronLines: [],
  misEmailLog: null,
  cancelledLog: null,
  subcontractorLog: null,
  nightlyYtdLog: null,
  today: '2026-08-27',
  catalogPaused: new Set(),
});
assert.ok(brokenInbound.some((p) => p.id === 'inbound_mis_maildir' && !p.ok));

const mailBody = formatEveningOpsStatusMail({
  today: '2026-08-27',
  scoreOk: false,
  summaryLine: 'FAIL — 1/2 failed: midnight_delta',
  steps: [
    { id: 'preflight', label: 'Preflight', ok: true, detail: 'env ok' },
    {
      id: 'midnight_delta',
      label: 'Midnight CRM delta (last-night check)',
      ok: false,
      detail: '00:00 calls sync FATAL and no 00:15 mail marker yet',
    },
  ],
  inventory: {
    syncWorkers: ['daemon active'],
    cronLines: [],
    systemd: [],
    catalog: [],
    mailMatrix: [],
    mailPipelines: [
      {
        id: 'inbound_mis_maildir',
        label: 'Inbound mis@ → Maildir',
        ok: false,
        status: 'BROKEN',
        detail: 'loopback-only',
      },
    ],
    broken: [],
    productionSendsToday: [],
  },
});
assert.match(mailBody, /MAIL PIPELINES — LIVE/);
assert.match(mailBody, /BROKEN/);
assert.match(mailBody, /WHAT BROKE/);

const expl = explainFailedStep({
  id: 'midnight_delta',
  label: 'Midnight CRM delta',
  ok: false,
  detail: '00:15 CRM delta MAIL failed — you did not get last night’s midnight delta report',
});
assert.match(expl.plain, /00:15/);

console.log('evening-ops-status ok');
