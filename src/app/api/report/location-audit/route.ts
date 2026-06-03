import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { exportLocationAuditCsv } from '@/lib/location-audit';
import {
  fetchLocationAuditList,
  fetchLocationAuditRowDetail,
  fetchLocationAuditSummary,
  parseLocationAuditQueryParams,
  resolveLocationAuditSecurity,
  runLocationAuditExport,
} from '@/lib/location-audit/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveLocationAuditSecurity(user.id);
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
      const rows = await runLocationAuditExport(params);
      const csv = exportLocationAuditCsv(rows);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="location-audit-${params.startDate}-${params.endDate}.csv"`,
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
