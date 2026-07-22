import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/features/arcp/lib/server/route-auth';
import {
  mergeJobAggregatesFromDisk,
  mergeJobDetailFromDisk,
  startOrResumeLoadJob,
  type ArcpLoadJobView,
} from '@/features/arcp/lib/server/load-job';
import { deriveArcpGrandTotalsFromAggregates } from '@/features/arcp/lib/query';
import type { ArcpChunkCacheKind } from '@/features/arcp/lib/server/chunk-cache';

export const maxDuration = 60;

function jobProgress(job: ArcpLoadJobView) {
  return {
    totalChunks: job.totalChunks,
    doneCount: job.doneCount,
    pendingCount: job.pendingCount,
    failedCount: job.failedCount,
    cachedCount: job.doneCount,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') === 'detail' ? 'detail' : 'agg') as ArcpChunkCacheKind;
    const force = searchParams.get('force') === 'true';

    const auth = await authenticateArcpClaimsRequest(req, { kind });
    if (auth instanceof NextResponse) return auth;

    const job = await startOrResumeLoadJob(auth.userId, auth.opts, kind, force);

    if (!job) {
      return NextResponse.json({
        jobsEnabled: false,
        jobId: null,
        chunks: [],
        progress: {
          totalChunks: 0,
          doneCount: 0,
          pendingCount: 0,
          failedCount: 0,
          cachedCount: 0,
        },
        partialAggregates: [],
        partialRows: [],
      });
    }

    if (kind === 'detail') {
      const partialRows = await mergeJobDetailFromDisk(job);
      return NextResponse.json({
        jobId: job.jobId,
        jobKey: job.jobKey,
        kind: job.kind,
        status: job.status,
        chunks: job.chunks,
        progress: jobProgress(job),
        partialRows,
        rowCount: partialRows.length,
      });
    }

    const partialAggregates = await mergeJobAggregatesFromDisk(job);
    const grandTotals = deriveArcpGrandTotalsFromAggregates(partialAggregates);

    return NextResponse.json({
      jobId: job.jobId,
      jobKey: job.jobKey,
      kind: job.kind,
      status: job.status,
      chunks: job.chunks,
      progress: jobProgress(job),
      partialAggregates,
      grandTotals,
    });
  } catch (err: unknown) {
    console.error('[ARCP Load Start] error:', err);
    const message = err instanceof Error ? err.message : 'Failed to start load job';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
