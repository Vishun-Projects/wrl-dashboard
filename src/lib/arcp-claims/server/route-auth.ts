import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { hasPagePermission } from '@/lib/auth/page-access';
import { fetchAppUserAuthProfile } from '@/lib/auth/app-user-profile';
import { resolveArcpDateFilterColumn } from '@/lib/arcp-claims/query';
import { resolveUserIdFromAccessToken } from '@/lib/auth/server-user';
import type { ArcpFetchOpts } from '@/lib/arcp-claims/server/fetch';

export type ArcpClaimsAuthContext = {
  userId: string;
  isHod: boolean;
  assignedOffices: string[];
  opts: ArcpFetchOpts;
};

export async function authenticateArcpClaimsRequest(
  req: NextRequest,
  options?: { bypassChunkCache?: boolean; jobId?: string | null; kind?: 'agg' | 'detail' }
): Promise<ArcpClaimsAuthContext | NextResponse> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
  }

  const token = authHeader.split(' ')[1];
  const userId = await resolveUserIdFromAccessToken(token);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as { getUserPermissions: (id: string) => Promise<string[]> }).getUserPermissions(
    userId
  );
  if (!hasPagePermission(permissions, 'page_arcp_claims')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const dateFilterColumn = resolveArcpDateFilterColumn(searchParams.get('dateFilterColumn'));
  const branch = searchParams.get('branch');
  const franchisee = searchParams.get('franchisee');
  const callType = searchParams.get('callType');

  const profile = await fetchAppUserAuthProfile(userId);

  const assignedOffices = (profile?.office_ids || []).map(String);
  const isHod =
    permissions.includes('view_all_offices') ||
    ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(
      profile?.role || ''
    );

  const jobId = options?.jobId ?? searchParams.get('jobId');

  return {
    userId,
    isHod,
    assignedOffices,
    opts: {
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      dateFilterColumn,
      branch: branch ?? null,
      franchisee: franchisee ?? null,
      callType: callType ?? null,
      isHod,
      assignedOffices,
      bypassChunkCache: options?.bypassChunkCache,
      jobId: jobId || undefined,
      loadJobKind: options?.kind,
    },
  };
}
