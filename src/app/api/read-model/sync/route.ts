import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { runIncrementalSync, isPostgresLockError } from '@/lib/read-model/incremental';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('view_reports') && !permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'SYNC_WORKER_ENABLED is not true — incremental sync is disabled' },
      { status: 503 }
    );
  }

  try {
    const result = await runIncrementalSync();
    const syncMeta = await getSyncMeta();
    return NextResponse.json({ ...result, syncMeta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Incremental sync failed';
    if (isPostgresLockError(err)) {
      return NextResponse.json(
        {
          error: 'Sync is already running — please wait a minute and try again',
          skipped: true,
          reason: message,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
