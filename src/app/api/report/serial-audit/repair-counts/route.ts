import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { mapRepairCountsFromApiRow } from '@/lib/serial-audit-repair-options';
import { buildSerialAuditRepairCountsBySerialSql } from '@/lib/trhcalls-query';

const QUERY_TIMEOUT_MS = 120000;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id);
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const callType = searchParams.get('callType') || 'All';
    const repair = searchParams.get('repair') || 'All';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const res = await postQuery({
      rawSql: buildSerialAuditRepairCountsBySerialSql({
        callType,
        repair: repair === 'All' ? null : repair,
        startDate,
        endDate,
        isHod: security.isHod,
        assignedOffices: security.assignedOffices,
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
    const message = err instanceof Error ? err.message : 'Failed to load repair counts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
