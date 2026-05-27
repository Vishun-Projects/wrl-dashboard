import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, assertSyncWorkerEnabled } from '@/lib/read-model/cron-auth';
import { runNightlyReconcile } from '@/lib/read-model/nightly';
import { getSyncMeta } from '@/lib/read-model/sync-meta';

/** Nightly reconcile — hot refresh, YTD facts rebuild, dimensions. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = authorizeCronRequest(req);
  if (authError) return authError;

  const enabledError = assertSyncWorkerEnabled();
  if (enabledError) return enabledError;

  try {
    await runNightlyReconcile();
    const syncMeta = await getSyncMeta();
    return NextResponse.json({ source: 'vercel-cron', ok: true, syncMeta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Nightly reconcile failed';
    console.error('[read-model/cron/nightly]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
