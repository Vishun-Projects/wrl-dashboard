import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'mis-digest-status-'));
  process.env.SYNC_SHARED_LOG_DIR = dir;
  writeFileSync(
    join(dir, 'mis-email-digest-status.json'),
    JSON.stringify({
      running: true,
      phase: 'reconcile',
      asOf: '2026-09-07',
      pid: process.pid,
      startedAt: '2026-09-08T09:30:01+05:30',
      updatedAt: '2026-09-08T09:31:00+05:30',
      lastFinishedAt: null,
      lastOutcome: null,
      lastSkipReason: null,
      lastSentCount: null,
    }),
    'utf8'
  );

  const { readMisEmailDigestRunStatus } = await import(
    '@/modules/mis-email/services/digest-run-status'
  );
  const status = readMisEmailDigestRunStatus();
  assert.equal(status.running, true);
  assert.equal(status.phase, 'reconcile');
  assert.equal(status.asOf, '2026-09-07');

  rmSync(dir, { recursive: true, force: true });
  console.log('digest-run-status ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
