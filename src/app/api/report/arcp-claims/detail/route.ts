import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';
import {
  isCrmOutOfMemoryError,
  isCrmSqlTimeoutError,
} from '@/lib/arcp-claims-fetch';
import { loadArcpClaimsDetailRows } from '@/lib/arcp-claims-detail-load';
import { resolveArcpDateFilterColumn } from '@/lib/arcp-claims-query';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await (prisma as any).getUserPermissions(user.id);
    if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const dateFilterColumn = resolveArcpDateFilterColumn(searchParams.get('dateFilterColumn'));
    const branch = searchParams.get('branch');
    const franchisee = searchParams.get('franchisee');
    const callType = searchParams.get('callType');

    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('office_ids, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = (profile?.office_ids || []).map(String);
    const isHod =
      permissions.includes('view_all_offices') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(
        profile?.role || ''
      );

    const { rows, source } = await loadArcpClaimsDetailRows({
      startDate,
      endDate,
      dateFilterColumn,
      branch,
      franchisee,
      callType,
      isHod,
      assignedOffices,
    });

    return NextResponse.json({
      rows,
      meta: {
        startDate,
        endDate,
        dateFilterColumn,
        rowCount: rows.length,
        source,
      },
    });
  } catch (err: unknown) {
    console.error('[ARCP Claims Detail] fetch error:', err);
    if (isCrmOutOfMemoryError(err)) {
      return NextResponse.json(
        {
          error:
            'CRM query returned too much data. Narrow the date range or add branch/franchisee filters.',
        },
        { status: 507 }
      );
    }
    if (isCrmSqlTimeoutError(err)) {
      const message = err instanceof Error ? err.message : '';
      return NextResponse.json(
        {
          error:
            message.includes('CRM timed out loading ARCP tally for')
              ? message
              : 'CRM query timed out while loading part of the date range. Please retry.',
        },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : 'Failed to load ARCP claim detail';
    const statusCode = (err as Error & { statusCode?: number }).statusCode;
    return NextResponse.json({ error: message }, { status: statusCode ?? 500 });
  }
}
