import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { prisma } from '@/lib/db/prisma';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import { resolveHotWindowCoverage } from '@/lib/read-model/hot-window';
import { queryDistributionCompactFromPostgres } from '@/lib/read-model/queries/register';
import { isHodUser } from '@/lib/auth/report-security';

export async function GET(req: NextRequest) {
  try {
    if (!readRegisterFromPostgres()) {
      return NextResponse.json({ error: 'Postgres read model required' }, { status: 400 });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

    const permissions = await (prisma as any).getUserPermissions(user.id);
    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('office_ids, visible_statuses, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = profile?.office_ids || [];
    const visibleStatuses = profile?.visible_statuses || [];
    const isHod = isHodUser(profile ?? undefined, permissions);

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
