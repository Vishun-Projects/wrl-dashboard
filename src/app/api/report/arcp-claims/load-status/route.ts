import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/features/arcp/server/route-auth';
import {
  getLatestLoadJob,
  getLatestResumableLoadJob,
  getLoadJobById,
  getLoadJobStatus,
  mergeJobAggregatesFromDisk,
  mergeJobDetailFromDisk,
  type ArcpLoadJobView,
} from '@/features/arcp/server/load-job';
import { jsonSafeError } from '@/lib/api/safe-error';
import { deriveArcpGrandTotalsFromAggregates } from '@/features/arcp/services/query';
import type { ArcpChunkCacheKind } from '@/features/arcp/server/chunk-cache';

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
    const progressOnly = searchParams.get('progressOnly') === 'true';
    const jobId = searchParams.get('jobId');
    const latestParam = searchParams.get('latest');
    const latestAny = latestParam === 'any';
    const latestResumable = latestParam === 'true';

    const auth = await authenticateArcpClaimsRequest(req, { kind });
    if (auth instanceof NextResponse) return auth;

    let job: ArcpLoadJobView | null = null;
    if (jobId) {
      job = await getLoadJobById(auth.userId, jobId, { skipReconcile: progressOnly });
    } else if (latestAny) {
      job = await getLatestLoadJob(auth.userId, kind);
    } else if (latestResumable) {
      job = await getLatestResumableLoadJob(auth.userId, kind);
    } else {
      job = await getLoadJobStatus(auth.userId, auth.opts, kind);
    }

    if (!job) {
      return NextResponse.json({ job: null });
    }

    if (kind === 'detail' && progressOnly) {
      // Chunk counts only — merging ~200k cached rows on every poll was the slow path.
      return NextResponse.json({
        jobId: job.jobId,
        jobKey: job.jobKey,
        kind: job.kind,
        status: job.status,
        filters: job.filters,
        progress: jobProgress(job),
        resumable: job.status === 'running' || job.pendingCount > 0 || job.failedCount > 0,
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
        filters: job.filters,
        progress: jobProgress(job),
        partialRows,
        rowCount: partialRows.length,
        rowCountSource: 'cache',
        resumable: job.status === 'running' || job.pendingCount > 0 || job.failedCount > 0,
      });
    }

    const progress = jobProgress(job);
    const resumable =
      job.status === 'running' || job.pendingCount > 0 || job.failedCount > 0;

    if (progressOnly) {
      return NextResponse.json({
        jobId: job.jobId,
        jobKey: job.jobKey,
        kind: job.kind,
        status: job.status,
        filters: job.filters,
        progress,
        resumable,
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
      progress,
      partialAggregates,
      grandTotals,
      resumable,
    });
  } catch (err: unknown) {
    console.error('[ARCP Load Status] error:', err);
    return jsonSafeError(err, 500, 'Failed to read load job status');
  }
}
