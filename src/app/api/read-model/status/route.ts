import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { prisma } from '@/lib/db/prisma';
import { hasAnyReportPageAccess } from '@/lib/auth/rbac-catalog';
import { getReadModelProgress } from '@/lib/read-model/sync-meta';

export async function GET() {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!hasAnyReportPageAccess(permissions) && !permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const progress = await getReadModelProgress();
    return NextResponse.json(progress);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load sync status';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
