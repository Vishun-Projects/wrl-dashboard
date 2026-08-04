import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/modules/arcp-claims/server/route-auth';
import {
  mergeJobAggregatesFromDisk,
  mergeJobDetailFromDisk,
  startOrResumeLoadJob,
  type ArcpLoadJobView,
} from '@/modules/arcp-claims/server/load-job';
import { jsonSafeError } from '@/lib/api/safe-error';
import { loadArcpClaimsDetailRowsHybrid as loadArcpClaimsDetailRows } from '@/modules/arcp-claims/server/hybrid-load';
import { deriveArcpGrandTotalsFromAggregates } from '@/sql/arcp-claims/query';
import type { ArcpChunkCacheKind } from '@/modules/arcp-claims/server/chunk-cache';
import type { ArcpFetchOpts } from '@/modules/arcp-claims/server/fetch';

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

const runningDetailJobs = new Set<string>();

function startDetailJobRunner(jobId: string, opts: ArcpFetchOpts): void {
  if (runningDetailJobs.has(jobId)) return;
  runningDetailJobs.add(jobId);
  void loadArcpClaimsDetailRows({
    ...opts,
    jobId,
    loadJobKind: 'detail',
  })
    .catch((err) => {
      console.error('[ARCP Load Start] detail background runner error:', err);
    })
    .finally(() => {
      runningDetailJobs.delete(jobId);
    });
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
      startDetailJobRunner(job.jobId, auth.opts);
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
    return jsonSafeError(err, 500, 'Failed to start load job');
  }
}
