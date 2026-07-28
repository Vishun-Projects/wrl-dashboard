import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/features/arcp/lib/server/route-auth';
import { loadArcpClaimsDetailRows } from '@/features/arcp/lib/server/detail-load';
import {
  buildArcpClaimsDetailCsvFileName,
  createArcpClaimsDetailCsvResponse,
  finalizeArcpDetailExportRows,
  sumArcpDetailExportTotals,
} from '@/features/arcp/lib/export';
import { resolveArcpDateFilterColumn } from '@/features/arcp/lib/query';
import {
  queryArcpClaimsDetailRows,
} from '@/features/arcp/lib/server/postgres';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/features/arcp/lib/server/fetch';
import {
  getLoadJobById,
  mergeJobDetailFromDisk,
} from '@/features/arcp/lib/server/load-job';
import { getArcpPostgresCoverage } from '@/lib/read-model/arcp/coverage-server';
import { postgresCoversFullRange } from '@/lib/read-model/arcp/coverage-shared';
import { readArcpFromPostgres } from '@/lib/read-model/flags';
import type { ArcpClaimsDetailRow } from '@/features/arcp/lib/query';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateArcpClaimsRequest(req, { kind: 'detail' });
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const includeTravel = searchParams.get('includeTravel') !== 'false';
    const startDate = auth.opts.startDate ?? '';
    const endDate = auth.opts.endDate ?? '';
    const fileName = buildArcpClaimsDetailCsvFileName(startDate, endDate);
    const dateColumn = resolveArcpDateFilterColumn(auth.opts.dateFilterColumn);
    const coverage = await getArcpPostgresCoverage();
    const postgresOnly =
      readArcpFromPostgres() ||
      (startDate &&
        endDate &&
        postgresCoversFullRange(startDate, endDate, coverage, dateColumn));

    // One indexed Postgres scan — never re-run weekly job chunks on export.
    // jobId used to skip this path and re-load for minutes after the prefetch already finished.
    if (postgresOnly && dateColumn === 'bm_approved_at') {
      let rows: ArcpClaimsDetailRow[] | null = null;
      if (auth.opts.jobId) {
        const job = await getLoadJobById(auth.userId, auth.opts.jobId, {
          skipReconcile: true,
        });
        if (job && job.pendingCount === 0 && job.failedCount === 0 && job.doneCount > 0) {
          const cached = await mergeJobDetailFromDisk(job);
          if (cached.length > 0) rows = cached;
        }
      }
      if (!rows) {
        rows = await queryArcpClaimsDetailRows(auth.opts);
      }
      const preparedRows = includeTravel
        ? rows
        : rows.filter((row) => row.line_type !== 'Travel');
      const totals = sumArcpDetailExportTotals(preparedRows);
      return createArcpClaimsDetailCsvResponse(preparedRows, fileName, { totals });
    }

    const { rows } = await loadArcpClaimsDetailRows({
      ...auth.opts,
      loadJobKind: 'detail',
      jobId: auth.opts.jobId,
    });
    const preparedRows = finalizeArcpDetailExportRows(rows, {
      dateFilterColumn: dateColumn,
      includeTravel,
    });
    const totals = sumArcpDetailExportTotals(preparedRows);

    return createArcpClaimsDetailCsvResponse(preparedRows, fileName, { totals });
  } catch (err: unknown) {
    console.error('[ARCP Claims Detail Export] export error:', err);
    if (isCrmOutOfMemoryError(err)) {
      return NextResponse.json(
        {
          error:
            'Query returned too much data. Narrow the date range or add branch/franchisee filters.',
        },
        { status: 507 }
      );
    }
    if (isCrmSqlTimeoutError(err)) {
      return NextResponse.json(
        {
          error:
            'Request timed out while preparing the export. Please retry.',
        },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to export ARCP claim detail';
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    return NextResponse.json({ error: message }, { status: statusCode ?? 500 });
  }
}
