import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { serializeRepairFilterParam } from '@/lib/serial-audit-repair-options';
import { buildSerialAuditCallIdsWithRepairSql } from '@/lib/trhcalls-query';

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
    const repair = searchParams.get('repair') || 'All';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (repair === 'All' || !repair.trim()) {
      return NextResponse.json({ callIds: [] });
    }

    const res = await postQuery({
      rawSql: buildSerialAuditCallIdsWithRepairSql({
        repair,
        startDate,
        endDate,
        isHod: security.isHod,
        assignedOffices: security.assignedOffices,
      }),
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    const rows = (res.data || []) as Record<string, unknown>[];
    const callIds = rows
      .map((row) => String(row.call_ncode ?? '').trim())
      .filter(Boolean);

    return NextResponse.json({
      callIds,
      repair: serializeRepairFilterParam(repair.split(',')),
    });
  } catch (err: unknown) {
    console.error('Serial Audit repair-call-ids API Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to resolve repair calls';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
