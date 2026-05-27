import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest, assertSyncWorkerEnabled } from '@/lib/read-model/cron-auth';
import { runRetentionJobs } from '@/lib/read-model/retention';

/** Purge old sync logs and ingest batches. */
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = authorizeCronRequest(req);
  if (authError) return authError;

  const enabledError = assertSyncWorkerEnabled();
  if (enabledError) return enabledError;

  try {
    await runRetentionJobs();
    return NextResponse.json({ source: 'vercel-cron', ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Retention job failed';
    console.error('[read-model/cron/retention]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
