import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { exportLocationAuditCsv } from '@/features/location-audit/lib';
import { gzippedCsvPayload } from '@/lib/net/csv-gzip-response';
import {
  fetchLocationAuditFull,
  fetchLocationAuditList,
  fetchLocationAuditRowDetail,
  fetchLocationAuditSummary,
  parseLocationAuditQueryParams,
  resolveLocationAuditSecurity,
  runLocationAuditExport,
} from '@/features/location-audit/lib/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAction } from '@/lib/security/audit';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveLocationAuditSecurity(user.id, {
      pageId: 'location_audit',
    });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') ?? 'list';

    if (mode === 'row') {
      const ncode = searchParams.get('ncode') ?? '';
      const officeId = searchParams.get('officeId') ?? '';
      if (!ncode || !officeId) {
        return NextResponse.json({ error: 'ncode and officeId are required' }, { status: 400 });
      }
      const row = await fetchLocationAuditRowDetail(ncode, officeId, security);
      if (!row) {
        return NextResponse.json({ error: 'Call not found' }, { status: 404 });
      }
      return NextResponse.json({
        row,
        meta: { auditMode: 'multi_signal', tier: 'detail' },
      });
    }

    const parsed = parseLocationAuditQueryParams(searchParams, security);
    if (parsed.error || !parsed.params) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const params = parsed.params;
    const format = searchParams.get('format');

    if (format === 'csv') {
      const startedAt = Date.now();
      const rows = await runLocationAuditExport(params);
      const csv = exportLocationAuditCsv(rows);
      const filename = `location-audit-${params.startDate}-${params.endDate}.csv`;
      const userAuth = await loadUserAuth(user.id);
      await logAction({
        request: req,
        action: 'report.export.complete',
        actor: {
          userId: user.id,
          email: userAuth?.profile?.email ?? user.email ?? null,
          name: userAuth?.profile?.name ?? null,
        },
        result: 'completed',
        statusCode: 200,
        target: { type: 'location_audit_export', label: filename },
        summary: `Exported location audit (${rows.length} rows)`,
        metadata: {
          reportName: 'location_audit',
          format: 'csv',
          rowCount: rows.length,
          filters: {
            startDate: params.startDate,
            endDate: params.endDate,
          },
          durationMs: Date.now() - startedAt,
        },
      });
      const { body, headers } = gzippedCsvPayload(
        csv,
        filename,
        req.headers.get('accept-encoding')
      );
      return new NextResponse(body, { headers });
    }

    if (mode === 'full') {
      const { summary, byBranch, analyzedCount, rows, total } =
        await fetchLocationAuditFull(params);
      return NextResponse.json({
        summary,
        byBranch,
        analyzedCount,
        rows,
        total,
        meta: {
          startDate: params.startDate,
          endDate: params.endDate,
          callType: params.callType,
          scope: 'tech_solved_major_breakdown',
          auditMode: 'pincode_mismatch',
          analyzedCount,
          tier: 'full',
          cap: 2000,
        },
      });
    }

    if (mode === 'summary') {
      const { summary, byBranch, analyzedCount } = await fetchLocationAuditSummary(params);
      return NextResponse.json({
        summary,
        byBranch,
        analyzedCount,
        meta: {
          startDate: params.startDate,
          endDate: params.endDate,
          callType: params.callType,
          scope: 'tech_solved_major_breakdown',
          auditMode: 'pincode_mismatch',
          analyzedCount,
          cap: 2000,
        },
      });
    }

    if (mode === 'byBranch') {
      const { byBranch } = await fetchLocationAuditSummary(params);
      return NextResponse.json({ byBranch });
    }

    const list = await fetchLocationAuditList(params);
    return NextResponse.json({
      rows: list.rows,
      total: list.total,
      meta: {
        startDate: params.startDate,
        endDate: params.endDate,
        callType: params.callType,
        scope: 'tech_solved_major_breakdown',
        auditMode: 'pincode_mismatch',
        tier: 'list',
      },
    });
  } catch (err) {
    console.error('[location-audit]', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
