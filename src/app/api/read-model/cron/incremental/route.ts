import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, assertSyncWorkerEnabled } from '@/lib/read-model/cron-auth';
import { runIncrementalSync } from '@/lib/read-model/incremental';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

/** Vercel Cron replacement for `sync-worker:daemon` — one incremental run per invocation. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = authorizeCronRequest(req);
  if (authError) return authError;

  const enabledError = assertSyncWorkerEnabled();
  if (enabledError) return enabledError;

  try {
    const result = await runIncrementalSync();
    const syncMeta = await getSyncMeta();
    return NextResponse.json({ source: 'vercel-cron', ...result, syncMeta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Incremental sync failed';
    console.error('[read-model/cron/incremental]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
