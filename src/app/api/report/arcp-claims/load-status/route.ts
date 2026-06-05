import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/lib/arcp-claims/server/route-auth';
import {
  getLatestResumableLoadJob,
  getLoadJobById,
  getLoadJobStatus,
  mergeJobAggregatesFromDisk,
  mergeJobDetailFromDisk,
  type ArcpLoadJobView,
} from '@/lib/arcp-claims/server/load-job';
import { deriveArcpGrandTotalsFromAggregates } from '@/lib/arcp-claims/query';
import type { ArcpChunkCacheKind } from '@/lib/arcp-claims/server/chunk-cache';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get('kind') === 'detail' ? 'detail' : 'agg') as ArcpChunkCacheKind;
    const jobId = searchParams.get('jobId');
    const latest = searchParams.get('latest') === 'true';

    const auth = await authenticateArcpClaimsRequest(req, { kind });
    if (auth instanceof NextResponse) return auth;

    let job: ArcpLoadJobView | null = null;
    if (jobId) {
      job = await getLoadJobById(auth.userId, jobId);
    } else if (latest) {
      job = await getLatestResumableLoadJob(auth.userId, kind);
    } else {
      job = await getLoadJobStatus(auth.userId, auth.opts, kind);
    }

    if (!job) {
      return NextResponse.json({ job: null });
    }

    if (kind === 'detail') {
      const partialRows = await mergeJobDetailFromDisk(job);
      return NextResponse.json({
        jobId: job.jobId,
        jobKey: job.jobKey,
        kind: job.kind,
        status: job.status,
        chunks: job.chunks,
        filters: job.filters,
        progress: jobProgress(job),
        partialRows,
        rowCount: partialRows.length,
        resumable: job.status === 'running' || job.pendingCount > 0 || job.failedCount > 0,
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
      filters: job.filters,
      progress: jobProgress(job),
      partialAggregates,
      grandTotals,
      resumable: job.status === 'running' || job.pendingCount > 0 || job.failedCount > 0,
    });
  } catch (err: unknown) {
    console.error('[ARCP Load Status] error:', err);
    const message = err instanceof Error ? err.message : 'Failed to read load job status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
