import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/db/prisma';
import { getReadModelProgress } from '@/lib/read-model/sync-meta';

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('view_reports') && !permissions.includes('manage_users')) {
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
