/**
 * Start thorough calls→hot sync capped through yesterday IST (manual UI / relay).
 * Fire-and-forget — sync can take many minutes.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export function istYesterdayYmd(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return new Date(utc - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type StartCallsHotSyncResult = {
  started: boolean;
  asOf: string;
  pid: number | null;
  logPath: string;
  detail: string;
};

function resolveCodeRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'package.json'))) return cwd;
  return resolve(cwd, '../..');
}

export function ytdStartYmd(now = new Date()): string {
  const year = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
  }).format(now);
  return process.env.SYNC_EDITEDON_CATCHUP_FROM?.trim() || `${year}-01-01`;
}

export function startCallsHotSyncThroughYesterday(
  options?: { asOf?: string; rootDir?: string }
): StartCallsHotSyncResult {
  const root = options?.rootDir ?? resolveCodeRoot();
  const asOf = options?.asOf?.trim() || istYesterdayYmd();
  const ytdStart = ytdStartYmd();
  const script = join(root, 'scripts', 'vps-hosting', 'midnight-calls-sync.sh');
  if (!existsSync(script)) {
    throw new Error(`missing ${script}`);
  }

  const logDir = existsSync(join(root, '..', 'shared', 'logs'))
    ? join(root, '..', 'shared', 'logs')
    : join(root, 'logs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'manual-calls-hot-sync.log');
  const lockPath = join(logDir, 'manual-calls-hot-sync.lock');

  if (existsSync(lockPath)) {
    const prev = Number(readFileSync(lockPath, 'utf8').trim());
    if (prev && !Number.isNaN(prev)) {
      try {
        process.kill(prev, 0);
        return {
          started: false,
          asOf,
          pid: prev,
          logPath,
          detail: `already running (pid ${prev})`,
        };
      } catch {
        /* stale lock */
      }
    }
  }

  const outFd = openSync(logPath, 'a');
  writeSync(
    outFd,
    `\n=== manual calls-hot sync start ${new Date().toISOString()} YTD ${ytdStart} → ${asOf} ===\n`
  );

  const child = spawn('bash', [script], {
    cwd: root,
    env: {
      ...process.env,
      MIDNIGHT_SYNC_AS_OF: asOf,
      TZ: 'Asia/Kolkata',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=8192',
    },
    detached: true,
    stdio: ['ignore', outFd, outFd],
  });
  child.unref();

  const pid = child.pid ?? null;
  if (pid != null) writeFileSync(lockPath, String(pid));
  child.on('exit', () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === String(pid)) {
        unlinkSync(lockPath);
      }
    } catch {
      /* ignore */
    }
  });

  return {
    started: true,
    asOf,
    pid,
    logPath,
    detail: `Started YTD calls register sync ${ytdStart} → ${asOf} in background (pid ${pid ?? '?'})`,
  };
}
