import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type MisEmailDigestRunStatus = {
  running: boolean;
  phase: string;
  asOf: string | null;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  lastFinishedAt: string | null;
  lastOutcome: string | null;
  lastSkipReason: string | null;
  lastSentCount: number | null;
  statusFile: string;
};

function syncSharedLogsDir(): string {
  const fromEnv = process.env.SYNC_SHARED_LOG_DIR?.trim();
  if (fromEnv) return fromEnv;
  const install = process.env.MIS_EMAIL_INSTALL_ROOT?.trim() || process.env.SYNC_WORKER_INSTALL_ROOT?.trim();
  if (install) {
    const base = install.replace(/\/current\/?$/, '');
    return join(base, 'shared', 'logs');
  }
  // Vercel / local: no VPS cron status file.
  return join(process.cwd(), 'logs');
}

function statusFilePath(): string {
  return join(syncSharedLogsDir(), 'mis-email-digest-status.json');
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Read VPS digest status marker (written by mis-email-digest.sh). */
export function readMisEmailDigestRunStatus(): MisEmailDigestRunStatus {
  const statusFile = statusFilePath();
  const empty: MisEmailDigestRunStatus = {
    running: false,
    phase: 'unknown',
    asOf: null,
    pid: null,
    startedAt: null,
    updatedAt: null,
    lastFinishedAt: null,
    lastOutcome: null,
    lastSkipReason: null,
    lastSentCount: null,
    statusFile,
  };

  if (!existsSync(statusFile)) return empty;

  try {
    const raw = JSON.parse(readFileSync(statusFile, 'utf8')) as Record<string, unknown>;
    let running = raw.running === true;
    const pid = asNumber(raw.pid);

    // Stale lock: process gone → treat as not running.
    if (running && pid != null && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        running = false;
      }
    }

    return {
      running,
      phase: asString(raw.phase) ?? (running ? 'running' : 'idle'),
      asOf: asString(raw.asOf),
      pid,
      startedAt: asString(raw.startedAt),
      updatedAt: asString(raw.updatedAt),
      lastFinishedAt: asString(raw.lastFinishedAt),
      lastOutcome: asString(raw.lastOutcome),
      lastSkipReason: asString(raw.lastSkipReason),
      lastSentCount: asNumber(raw.lastSentCount),
      statusFile,
    };
  } catch {
    return empty;
  }
}
