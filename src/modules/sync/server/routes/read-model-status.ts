import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { prisma } from '@/lib/db/prisma';
import { hasAnyReportPageAccess } from '@/lib/auth/rbac-catalog';
import { getReadModelProgress } from '@/lib/read-model/sync-meta';
import { jsonSafeError } from '@/lib/api/safe-error';

export async function GET() {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await prisma.getUserPermissions(user.id);
  // Report readers need sync health; manage_users covers admin ops without a report tab.
  if (!hasAnyReportPageAccess(permissions) && !permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const progress = await getReadModelProgress();
    return NextResponse.json(progress);
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load sync status');
  }
}
