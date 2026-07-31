import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/modules/arcp/server/route-auth';
import { loadArcpClaimsDetailRowsHybrid as loadArcpClaimsDetailRows } from '@/modules/arcp/server/hybrid-load';
import {
  buildArcpClaimsDetailCsvFileName,
  createArcpClaimsDetailCsvResponse,
  finalizeArcpDetailExportRows,
  sumArcpDetailExportTotals,
} from '@/modules/arcp/services/export';
import { resolveArcpDateFilterColumn } from '@/sql/arcp/query';
import {
  queryArcpClaimsDetailRows,
} from '@/sql/arcp/postgres';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/modules/arcp/server/fetch';
import { safeErrorMessage } from '@/lib/api/safe-error';
import {
  getLoadJobById,
  mergeJobDetailFromDisk,
} from '@/modules/arcp/server/load-job';
import { getArcpPostgresCoverage } from '@/modules/arcp/server/sync/coverage-server';
import { postgresCoversFullRange } from '@/modules/arcp/server/sync/coverage-shared';
import { readArcpFromPostgres } from '@/lib/read-model/flags';
import type { ArcpClaimsDetailRow } from '@/sql/arcp/query';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAction } from '@/lib/security/audit';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  let actor: { userId: string | null; email: string | null; name: string | null } = {
    userId: null,
    email: null,
    name: null,
  };
  try {
    const auth = await authenticateArcpClaimsRequest(req, { kind: 'detail' });
    if (auth instanceof NextResponse) return auth;

    const userAuth = await loadUserAuth(auth.userId);
    actor = {
      userId: auth.userId,
      email: userAuth?.profile?.email ?? null,
      name: userAuth?.profile?.name ?? null,
    };

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

    const filters = {
      startDate,
      endDate,
      dateColumn,
      includeTravel,
      postgresOnly,
    };

    await logAction({
      request: req,
      action: 'report.export.start',
      actor,
      result: 'started',
      statusCode: 202,
      target: { type: 'arcp_claims_detail_export', label: fileName },
      summary: 'Started ARCP claims detail export',
      metadata: {
        reportName: 'arcp_claims_detail',
        format: 'csv',
        filters,
      },
    });

    // One indexed Postgres scan for any date basis — never re-run weekly job chunks on export.
    if (postgresOnly) {
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
      const preparedRows =
        dateColumn === 'bm_approved_at'
          ? includeTravel
            ? rows
            : rows.filter((row) => row.line_type !== 'Travel')
          : finalizeArcpDetailExportRows(rows, {
              dateFilterColumn: dateColumn,
              includeTravel,
            });
      const totals = sumArcpDetailExportTotals(preparedRows);
      await logAction({
        request: req,
        action: 'report.export.complete',
        actor,
        result: 'completed',
        statusCode: 200,
        target: { type: 'arcp_claims_detail_export', label: fileName },
        summary: `Exported ARCP claims detail (${preparedRows.length} rows)`,
        metadata: {
          reportName: 'arcp_claims_detail',
          format: 'csv',
          rowCount: preparedRows.length,
          filters,
          durationMs: Date.now() - startedAt,
        },
      });
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
    await logAction({
      request: req,
      action: 'report.export.complete',
      actor,
      result: 'completed',
      statusCode: 200,
      target: { type: 'arcp_claims_detail_export', label: fileName },
      summary: `Exported ARCP claims detail (${preparedRows.length} rows)`,
      metadata: {
        reportName: 'arcp_claims_detail',
        format: 'csv',
        rowCount: preparedRows.length,
        filters,
        durationMs: Date.now() - startedAt,
      },
    });

    return createArcpClaimsDetailCsvResponse(preparedRows, fileName, { totals });
  } catch (err: unknown) {
    console.error('[ARCP Claims Detail Export] export error:', err);
    await logAction({
      request: req,
      action: 'report.export.failure',
      actor,
      result: 'failure',
      statusCode: 500,
      target: { type: 'arcp_claims_detail_export' },
      summary: 'ARCP claims detail export failed',
      metadata: {
        reportName: 'arcp_claims_detail',
        format: 'csv',
        durationMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
      },
    });
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
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    console.error('[arcp-claims/detail/export]', err);
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to export ARCP claim detail') },
      { status: statusCode ?? 500 }
    );
  }
}
