import { NextRequest, NextResponse } from 'next/server';

/** Verify Vercel Cron (sends Authorization: Bearer CRON_SECRET when env is set). */
export function authorizeCronRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured — add it in Vercel env for scheduled sync' },
      { status: 503 }
    );
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function assertSyncWorkerEnabled(): NextResponse | null {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'SYNC_WORKER_ENABLED is not true — incremental sync is disabled' },
      { status: 503 }
    );
  }
  return null;
}
