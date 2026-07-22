import { NextRequest, NextResponse } from 'next/server';
import { hasPagePermission } from '@/lib/auth/rbac-catalog';
import { resolveArcpDateFilterColumn } from '@/features/arcp/lib/query';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isHodUser } from '@/lib/auth/report-security';
import { createClient } from '@/lib/supabase/server';
import type { ArcpFetchOpts } from '@/features/arcp/lib/server/fetch';

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
  const supabase = await createClient();
  const userId = await resolveRequestUserId(req, supabase);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(userId);
  const permissions = auth?.permissions ?? [];
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

  const profile = auth?.profile;
  const assignedOffices = (profile?.office_ids || []).map(String);
  const isHod = isHodUser(profile, permissions);

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
