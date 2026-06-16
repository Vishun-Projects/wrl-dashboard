import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { prisma } from '@/lib/db/prisma';
import { runArcpIncrementalSync } from '@/lib/read-model/arcp/incremental';
import { runIncrementalSync, isPostgresLockError } from '@/lib/read-model/incremental';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

/** Large CRM deltas can take several minutes (hot upsert + metric batches). */
export const maxDuration = 300;

export async function POST() {
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Background refresh is temporarily unavailable' },
      { status: 503 }
    );
  }

  try {
    const result = await runIncrementalSync();
    let arcpResult: Awaited<ReturnType<typeof runArcpIncrementalSync>> | undefined;
    if (process.env.SYNC_ARCP_ENABLED === 'true') {
      arcpResult = await runArcpIncrementalSync();
    }
    const syncMeta = await getSyncMeta();
    return NextResponse.json({ ...result, arcp: arcpResult, syncMeta });
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
