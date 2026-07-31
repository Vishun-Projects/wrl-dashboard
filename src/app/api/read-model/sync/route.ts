import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { prisma } from '@/lib/db/prisma';
import { runArcpIncrementalSync } from '@/lib/read-model/arcp/incremental';
import { runIncrementalSync, isPostgresLockError } from '@/lib/read-model/incremental';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { assertSameOriginMutation } from '@/lib/api/same-origin';

/** Large CRM deltas can take several minutes (hot upsert + metric batches). */
export const maxDuration = 300;

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireSupabaseUser(supabase);
  const audit = requestAuditContext(request);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'read_model_sync_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await prisma.getUserPermissions(user.id);
  if (!permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'read_model_sync_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    await logSecurityEventBestEffort({
      eventType: 'sync.manual.start',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 503,
      metadata: { reason: 'sync_worker_disabled' },
    });
    return NextResponse.json(
      { error: 'Background refresh is temporarily unavailable' },
      { status: 503 }
    );
  }

  try {
    await logSecurityEventBestEffort({
      eventType: 'sync.manual.start',
      result: 'started',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 202,
    });
    const result = await runIncrementalSync();
    let arcpResult: Awaited<ReturnType<typeof runArcpIncrementalSync>> | undefined;
    if (process.env.SYNC_ARCP_ENABLED === 'true') {
      arcpResult = await runArcpIncrementalSync();
    }
    const syncMeta = await getSyncMeta();
    await logSecurityEventBestEffort({
      eventType: 'sync.manual.complete',
      result: 'completed',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      metadata: { result, arcp: arcpResult },
    });
    return NextResponse.json({ ...result, arcp: arcpResult, syncMeta });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Incremental sync failed';
    await logSecurityEventBestEffort({
      eventType: 'sync.manual.failure',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: isPostgresLockError(err) ? 409 : 500,
      metadata: { message },
    });
    if (isPostgresLockError(err)) {
      return NextResponse.json(
        {
          error: 'Sync is already running — please wait a minute and try again',
          skipped: true,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: safeErrorMessage(err, 'Incremental sync failed') }, { status: 500 });
  }
}
