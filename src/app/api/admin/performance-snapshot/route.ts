import { NextResponse } from 'next/server';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessPerformanceInsights } from '@/lib/auth/insights-access';
import { getReadModelProgress } from '@/lib/read-model/sync-meta';

export async function GET() {
  const userInfo = await getUserInfo();
  if (!userInfo || !canAccessPerformanceInsights(userInfo.permissions)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let syncProgress: Awaited<ReturnType<typeof getReadModelProgress>> | null = null;
  let syncError: string | null = null;

  try {
    syncProgress = await getReadModelProgress();
  } catch (err: unknown) {
    syncError = err instanceof Error ? err.message : 'Failed to load sync status';
  }

  return NextResponse.json({
    capturedAt: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    deployment: {
      region: process.env.VERCEL_REGION ?? null,
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    readModel: {
      syncWorkerEnabled: process.env.SYNC_WORKER_ENABLED === 'true',
      readCallsFrom: process.env.READ_CALLS_FROM ?? null,
      readRegisterFrom: process.env.READ_REGISTER_FROM ?? null,
      readSummaryFrom: process.env.READ_SUMMARY_FROM ?? null,
      readDistributionFrom: process.env.READ_DISTRIBUTION_FROM ?? null,
      readArcpFrom: process.env.READ_ARCP_FROM ?? null,
      readDimsFrom: process.env.READ_DIMS_FROM ?? null,
    },
    clientFlags: {
      readCallsFrom: process.env.NEXT_PUBLIC_READ_CALLS_FROM ?? null,
      readRegisterFrom: process.env.NEXT_PUBLIC_READ_REGISTER_FROM ?? null,
      readSummaryFrom: process.env.NEXT_PUBLIC_READ_SUMMARY_FROM ?? null,
      readDistributionFrom: process.env.NEXT_PUBLIC_READ_DISTRIBUTION_FROM ?? null,
      readArcpFrom: process.env.NEXT_PUBLIC_READ_ARCP_FROM ?? null,
      autoSyncEnabled: process.env.NEXT_PUBLIC_AUTO_SYNC_ENABLED ?? null,
    },
    sync: syncProgress,
    syncError,
  });
}
