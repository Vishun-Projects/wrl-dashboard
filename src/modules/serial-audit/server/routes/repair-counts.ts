import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { postQuery } from '@/lib/db/proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { mapRepairCountsFromApiRow } from '@/sql/repair/options';
import { resolveSerialAuditSqlOpts } from '@/sql/serial-audit/sql-scope';
import { buildSerialAuditRepairCountsBySerialSql } from '@/sql/trhcalls/query';
import { jsonSafeError } from '@/lib/api/safe-error';

const QUERY_TIMEOUT_MS = 120000;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id, { pageId: 'serial_audit' });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const sqlOpts = await resolveSerialAuditSqlOpts({
      callType: searchParams.get('callType') || 'All',
      repair: searchParams.get('repair') || searchParams.get('complaint') || 'All',
      branch: searchParams.get('branch') || '',
      franchisee: searchParams.get('franchisee') || '',
      startDate,
      endDate,
      isHod: security.isHod,
      assignedOffices: security.assignedOffices,
    });

    const res = await postQuery({
      rawSql: buildSerialAuditRepairCountsBySerialSql({
        ...sqlOpts,
        repair: sqlOpts.repair === 'All' ? null : sqlOpts.repair,
      }),
      timeoutMs: QUERY_TIMEOUT_MS,
    });

    const rows = (res.data || []) as Record<string, unknown>[];
    const bySerial: Record<string, ReturnType<typeof mapRepairCountsFromApiRow>> = {};
    for (const row of rows) {
      const serial = String(row.serial ?? '').trim().toUpperCase();
      if (!serial) continue;
      bySerial[serial] = mapRepairCountsFromApiRow(row);
    }

    return NextResponse.json({ bySerial });
  } catch (err: unknown) {
    console.error('Serial Audit repair-counts API Error:', err);
    return jsonSafeError(err, 500, 'Failed to load repair counts');
  }
}
