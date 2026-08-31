import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { gzippedCsvPayload } from '@/lib/net/csv-gzip-response';
import {
  fetchAthenaFailedCallsRows,
  fetchAthenaFailedCallDetail,
  fetchAthenaReconciliationSummary,
  fetchAthenaReasonDateMatrix,
  generateAthenaReconciliationCsv,
  runAthenaFailedCallsSync,
  executeAthenaReconciliation,
  type AthenaReconciliationFilterParams,
  type AthenaReconciliationStatus,
} from '@/lib/read-model/athena-reconciliation';

function parseListParam(searchParams: URLSearchParams, ...keys: string[]): string[] | null {
  const items: string[] = [];
  for (const k of keys) {
    const all = searchParams.getAll(k);
    for (const val of all) {
      if (!val) continue;
      const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
      items.push(...parts);
    }
  }
  return items.length > 0 ? Array.from(new Set(items)) : null;
}

function parseFilterParams(searchParams: URLSearchParams): AthenaReconciliationFilterParams {
  const statusParam = searchParams.get('status')?.trim().toUpperCase();
  const validStatuses: Array<AthenaReconciliationStatus | 'ALL'> = [
    'ALL',
    'REGISTERED',
    'NOT_REGISTERED',
    'MULTIPLE_MATCHES',
    'INVALID_DATA',
  ];
  const status = validStatuses.includes(statusParam as any)
    ? (statusParam as AthenaReconciliationStatus | 'ALL')
    : null;

  const branches = parseListParam(searchParams, 'branch', 'branches');
  const clients = parseListParam(searchParams, 'client', 'clients');
  const callTypes = parseListParam(searchParams, 'callType', 'callTypes');
  const failureReasons = parseListParam(searchParams, 'failureReason', 'failureReasons');
  const excludedReasons = parseListParam(searchParams, 'excludedReasons');
  const treatAsRegisteredReasons = parseListParam(searchParams, 'treatAsRegisteredReasons');

  return {
    startDate: searchParams.get('startDate') || null,
    endDate: searchParams.get('endDate') || null,
    branch: branches,
    branches,
    client: clients,
    clients,
    callType: callTypes,
    callTypes,
    failureReason: failureReasons,
    failureReasons,
    status,
    search: searchParams.get('search') || null,
    excludedReasons,
    treatAsRegisteredReasons,
    page: parseInt(searchParams.get('page') || '1', 10),
    pageSize: parseInt(searchParams.get('pageSize') || '25', 10),
    sortBy: searchParams.get('sortBy') || undefined,
    sortDir: searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc',
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'athena_reconciliation' });
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const params = parseFilterParams(searchParams);
    const mode = searchParams.get('mode') ?? 'summary';
    const format = searchParams.get('format');

    if (format === 'csv') {
      const csv = await generateAthenaReconciliationCsv(params);
      const stamp = new Date().toISOString().slice(0, 10);
      const { body, headers } = gzippedCsvPayload(
        csv,
        `reconciliation-${stamp}.csv`,
        req.headers.get('accept-encoding')
      );
      return new NextResponse(body, { headers });
    }

    if (mode === 'rows') {
      const result = await fetchAthenaFailedCallsRows(params);
      return NextResponse.json(result);
    }

    if (mode === 'detail') {
      const id = parseInt(searchParams.get('id') || '', 10);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
      const detail = await fetchAthenaFailedCallDetail(id);
      if (!detail) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
      return NextResponse.json(detail);
    }

    if (mode === 'reason-matrix') {
      const matrixStart = searchParams.get('matrixStart');
      const matrixEnd = searchParams.get('matrixEnd');
      if (!matrixStart || !matrixEnd) {
        return NextResponse.json({ error: 'matrixStart and matrixEnd are required' }, { status: 400 });
      }
      const matrix = await fetchAthenaReasonDateMatrix(params, {
        start: matrixStart,
        end: matrixEnd,
      });
      return NextResponse.json(matrix);
    }

    const summary = await fetchAthenaReconciliationSummary(params);
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[athena-reconciliation-api]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, { pageId: 'athena_reconciliation' });
    if (!auth.ok) return auth.response;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is valid
    }

    const action = body.action || 'sync';

    if (action === 'reconcile') {
      const stats = await executeAthenaReconciliation(undefined, {
        reprocessAll: body.reprocessAll === true,
      });
      return NextResponse.json({ ok: true, action: 'reconcile', stats });
    }

    const syncResult = await runAthenaFailedCallsSync({
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      reprocessAll: body.reprocessAll,
      fullBackfill: body.fullBackfill,
    });

    return NextResponse.json(syncResult);
  } catch (err) {
    console.error('[athena-reconciliation-api-post]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
