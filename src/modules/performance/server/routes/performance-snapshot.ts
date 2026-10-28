import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import fs from 'fs';
import os from 'os';
import { getSessionUserId } from '@/lib/auth/session';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPerformanceInsights } from '@/lib/auth/insights-access';
import { getReadModelProgress } from '@/lib/read-model/sync-meta';
import { safeErrorMessage } from '@/lib/api/safe-error';

const SNAPSHOT_CACHE_TTL_MS = 10_000;
let snapshotCache:
  | {
      expiresAt: number;
      payload: Record<string, unknown>;
    }
  | null = null;

let lastCpuSnapshot: { idle: number; total: number; time: number } | null = null;

const getCachedReadModelProgress = unstable_cache(
  async () => getReadModelProgress(),
  ['admin-performance-snapshot-progress'],
  { revalidate: 10 }
);

function getDiskStorage() {
  try {
    if (typeof fs.statfsSync === 'function') {
      let targetPath = process.cwd();
      let stats = fs.statfsSync(targetPath);
      let totalBytes = stats.bsize * stats.blocks;

      // On serverless environments (e.g. Vercel Lambda), process.cwd() is /var/task
      // which is a read-only 10MB deployment zip mount with 0 free bytes (100% full).
      // Fallback to /tmp if process.cwd() is a tiny read-only mount (< 100MB).
      if (totalBytes < 100 * 1024 * 1024 && fs.existsSync('/tmp')) {
        try {
          const tmpStats = fs.statfsSync('/tmp');
          const tmpTotal = tmpStats.bsize * tmpStats.blocks;
          if (tmpTotal > totalBytes) {
            targetPath = '/tmp';
            stats = tmpStats;
            totalBytes = tmpTotal;
          }
        } catch {
          /* keep cwd stats */
        }
      }

      const freeBytes = stats.bsize * stats.bfree;
      const availableBytes = stats.bsize * stats.bavail;
      const usedBytes = totalBytes - freeBytes;
      const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
      return {
        totalBytes,
        usedBytes,
        freeBytes,
        availableBytes,
        usedPercent: Number(usedPercent.toFixed(1)),
      };
    }
  } catch {
    // Fallback if statfs is unavailable
  }
  return null;
}

function getSystemMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent,
  };
}

function getCpuUsage(): { percent: number; loadAvg: number[]; cpuCount: number; model: string } {
  const cpus = os.cpus();
  const cpuCount = cpus?.length ?? 1;
  const model = cpus?.[0]?.model ?? 'Generic CPU';
  let loadAvg: number[] = [];
  try {
    loadAvg = os.loadavg();
  } catch {
    loadAvg = [0, 0, 0];
  }

  let totalIdle = 0;
  let totalTick = 0;
  if (cpus && cpus.length > 0) {
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
  }

  let percent = 0;
  if (lastCpuSnapshot) {
    const idleDelta = totalIdle - lastCpuSnapshot.idle;
    const totalDelta = totalTick - lastCpuSnapshot.total;
    if (totalDelta > 0) {
      percent = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
    }
  } else {
    const load1 = loadAvg[0] ?? 0;
    percent = Math.max(0, Math.min(100, Math.round((load1 / cpuCount) * 100)));
  }

  lastCpuSnapshot = { idle: totalIdle, total: totalTick, time: Date.now() };

  return {
    percent,
    loadAvg,
    cpuCount,
    model,
  };
}

function getNetworkTraffic() {
  try {
    if (process.platform === 'linux' && fs.existsSync('/proc/net/dev')) {
      const content = fs.readFileSync('/proc/net/dev', 'utf-8');
      const lines = content.split('\n');
      let rxBytes = 0;
      let txBytes = 0;
      for (const line of lines) {
        if (line.includes(':') && !line.includes('lo:')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            rxBytes += parseInt(parts[1], 10) || 0;
            txBytes += parseInt(parts[9], 10) || 0;
          }
        }
      }
      return { rxBytes, txBytes };
    }
  } catch {
    /* skip if non-linux */
  }
  return null;
}

function getProcessMemory() {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers ?? 0,
    heapUsedPercent: mem.heapTotal > 0 ? Number(((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)) : 0,
  };
}

function getSystemInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    systemUptimeSeconds: Math.floor(os.uptime()),
  };
}

async function fetchRemoteVpsTelemetryViaHttp() {
  const secret = (
    process.env.VPS_TELEMETRY_PASSPHRASE ||
    process.env.VPS_MAIL_RELAY_SECRET ||
    ''
  ).trim();

  const baseUrl = (
    process.env.VPS_TELEMETRY_URL ||
    process.env.VPS_MAIL_RELAY_URL ||
    'https://api.wrl-fsm.cloud'
  ).trim().replace(/\/$/, '');

  const telemetryUrl = `${baseUrl}/api/admin/performance-snapshot`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const res = await fetch(telemetryUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-telemetry-secret': secret,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.cpuUsage && data.systemMemory) {
        return {
          cpu: data.cpuUsage,
          systemMemory: data.systemMemory,
          diskStorage: data.diskStorage,
          network: data.networkTraffic,
          systemInfo: data.systemInfo,
        };
      }
    }
  } catch {
    /* skip if unreachable */
  }
  return null;
}

export async function GET(request?: Request) {
  const userId = await getSessionUserId();
  const secretHeader = request?.headers?.get('x-telemetry-secret')?.trim();
  const expectedSecret = (
    process.env.VPS_TELEMETRY_PASSPHRASE ??
    process.env.VPS_MAIL_RELAY_SECRET ??
    process.env.SUPABASE_JWT_SECRET ??
    ''
  ).trim();

  // Validate authentication: session user OR valid telemetry secret header
  const isSecretAuthenticated = Boolean(
    expectedSecret && secretHeader && secretHeader === expectedSecret
  );

  if (!userId && !isSecretAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (userId && !isSecretAuthenticated) {
    const auth = await loadUserAuth(userId);
    if (!auth || !canAccessPerformanceInsights(auth.permissions)) {
      // 404 (not 403): hide insights endpoints from non-privileged callers.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  const passphraseInvalid = Boolean(secretHeader && !isSecretAuthenticated);

  const now = Date.now();
  if (!isSecretAuthenticated && snapshotCache && snapshotCache.expiresAt > now) {
    return NextResponse.json(snapshotCache.payload, {
      headers: { 'Cache-Control': 'private, max-age=10', 'X-Cache': 'HIT' },
    });
  }

  let syncProgress: Awaited<ReturnType<typeof getReadModelProgress>> | null = null;
  let syncError: string | null = null;

  try {
    syncProgress = await getCachedReadModelProgress();
  } catch (err: unknown) {
    syncError = safeErrorMessage(err, 'Failed to load sync status');
  }

  let cpu = getCpuUsage();
  let systemMemory = getSystemMemory();
  let diskStorage = getDiskStorage();
  let network = getNetworkTraffic();
  let systemInfo = getSystemInfo();
  let telemetrySource: 'http_relay' | 'local_node' = 'local_node';

  if (process.platform !== 'linux' || process.env.VERCEL === '1' || process.env.AWS_EXECUTION_ENV) {
    const remoteHttp = await fetchRemoteVpsTelemetryViaHttp();
    if (remoteHttp) {
      cpu = remoteHttp.cpu;
      systemMemory = remoteHttp.systemMemory;
      diskStorage = remoteHttp.diskStorage;
      network = remoteHttp.network;
      systemInfo = remoteHttp.systemInfo;
      telemetrySource = 'http_relay';
    }
  }

  const payload = {
    capturedAt: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'vps-production',
    deployment: {
      region: 'ap-south-1',
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'b8a74e2',
    },
    passphraseAuthenticated: isSecretAuthenticated,
    passphraseInvalid,
    sshBridgeActive: false,
    telemetrySource,
    cpuUsage: cpu,
    systemMemory,
    diskStorage,
    networkTraffic: network,
    processMemory: getProcessMemory(),
    systemInfo,
    readModel: {
      syncWorkerEnabled: process.env.SYNC_WORKER_ENABLED === 'true',
      readCallsFrom: process.env.READ_CALLS_FROM ?? 'postgres',
      readRegisterFrom: process.env.READ_REGISTER_FROM ?? 'postgres',
      readSummaryFrom: process.env.READ_SUMMARY_FROM ?? 'postgres',
      readDistributionFrom: process.env.READ_DISTRIBUTION_FROM ?? 'postgres',
      readArcpFrom: process.env.READ_ARCP_FROM ?? 'postgres',
      readDimsFrom: process.env.READ_DIMS_FROM ?? 'postgres',
    },
    clientFlags: {
      readCallsFrom: process.env.NEXT_PUBLIC_READ_CALLS_FROM ?? 'postgres',
      readRegisterFrom: process.env.NEXT_PUBLIC_READ_REGISTER_FROM ?? 'postgres',
      readSummaryFrom: process.env.NEXT_PUBLIC_READ_SUMMARY_FROM ?? 'postgres',
      readDistributionFrom: process.env.NEXT_PUBLIC_READ_DISTRIBUTION_FROM ?? 'postgres',
      readArcpFrom: process.env.NEXT_PUBLIC_READ_ARCP_FROM ?? 'postgres',
      autoSyncEnabled: process.env.NEXT_PUBLIC_AUTO_SYNC_ENABLED ?? 'true',
    },
    sync: syncProgress,
    syncError,
  };

  snapshotCache = { payload, expiresAt: now + SNAPSHOT_CACHE_TTL_MS };
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, max-age=10', 'X-Cache': 'MISS' },
  });
}
