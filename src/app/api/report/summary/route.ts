import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';
import {
  appendCallTypeFilter,
  appendOfficeSecurityFilter,
  buildCorpusFieldsSql,
  buildCorpusTableName,
  enrichTrhcallBranchFranchisee,
  TRHCALLS_EXCLUDE_TRANSFERRED,
} from '@/lib/trhcalls-query';
import { deriveSummaryDashboard } from '@/lib/report-summary-derive';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const permissions = await (prisma as any).getUserPermissions(user.id);
    if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf');

    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('office_ids, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = profile?.office_ids || [];
    const isHod =
      permissions.includes('view_all_offices') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    let condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
    condition = appendCallTypeFilter(condition, callType);
    condition = appendOfficeSecurityFilter(condition, isHod, assignedOffices);

    if (startDate) {
      condition += ` AND tc.dtrndate >= '${startDate.replace(/'/g, "''")}'`;
    }
    if (endDate) {
      condition += ` AND tc.dtrndate <= '${endDate.replace(/'/g, "''")} 23:59:59'`;
    }

    const rawRes = await postQuery({
      fields: buildCorpusFieldsSql(),
      tableName: buildCorpusTableName({ startDate, endDate }),
      condition,
      orderBy: 'tc.dtrndate DESC',
    });

    const rows = (rawRes.data || []).map((row: Record<string, unknown>) =>
      enrichTrhcallBranchFranchisee(row)
    );

    const agingStr =
      agingAsOf && !Number.isNaN(new Date(agingAsOf).getTime())
        ? new Date(agingAsOf).toISOString().split('T')[0]
        : agingAsOf || undefined;

    const result = deriveSummaryDashboard(rows, {
      agingAsOf: agingStr,
      endDate: endDate || undefined,
      officeIdsParam: officeId || 'All',
      callTypesParam: callType || 'All',
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Report Summary Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
