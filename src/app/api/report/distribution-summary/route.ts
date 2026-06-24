import { NextRequest, NextResponse } from 'next/server';
import { fetchAppUserAuthProfile } from '@/lib/auth/app-user-profile';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import { resolveHotWindowCoverage } from '@/lib/read-model/hot-window';
import { queryDistributionCompactFromPostgres } from '@/lib/read-model/queries/register';

export async function GET(req: NextRequest) {
  try {
    if (!readRegisterFromPostgres()) {
      return NextResponse.json({ error: 'Postgres read model required' }, { status: 400 });
    }

    const auth = await resolveRequestReportSecurity(req, { pageId: 'call_distribution' });
    if (!auth.ok) return auth.response;
    const { userId, security } = auth;

    if (!security.isHod && security.assignedOffices.length === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const officeId = searchParams.get('officeId') || 'All';
    const callType = searchParams.get('callType');
    const status = searchParams.get('status') || '';
    const account = searchParams.get('account') || '';
    const region = searchParams.get('region') || '';
    const pincode = searchParams.get('pincode') || '';
    const priority = searchParams.get('priority') || 'all';
    const portalFilter = searchParams.get('portalFilter') || 'All';
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';
    const branch = searchParams.get('branch') || '';
    const franchisee = searchParams.get('franchisee') || '';
    const technician = searchParams.get('technician') || '';

    const coverage = resolveHotWindowCoverage(startDate, endDate);
    if (coverage.mode !== 'postgres') {
      return NextResponse.json(
        { error: 'Date range is outside the Postgres hot window' },
        { status: 400 }
      );
    }

    const profile = await fetchAppUserAuthProfile(userId);

    const assignedOffices = security.assignedOffices;
    const visibleStatuses = profile?.visible_statuses || [];
    const isHod = security.isHod;

    const calls = await queryDistributionCompactFromPostgres({
      officeId,
      callType: callType ?? null,
      startDate,
      endDate,
      status,
      account,
      region,
      pincode,
      priority,
      portalFilter,
      state,
      city,
      branch,
      franchisee,
      technician,
      assignedOffices,
      visibleStatuses,
      isHod,
    });

    return NextResponse.json({
      calls,
      total: calls.length,
      readSource: 'postgres',
      compact: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Distribution summary failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
