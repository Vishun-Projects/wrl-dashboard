import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import {
  logAccessDenied,
  logSecurityEventBestEffort,
  requestAuditContext,
  type RequestAuditContext,
} from '@/lib/security/audit';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError } from '@/lib/api/safe-error';
import { canManageVpsCron } from '@/lib/security/audit-access';
import { isVpsCronJobId } from '@/lib/vps-cron/catalog';
import { listVpsCronJobStatus, setVpsCronPaused } from '@/lib/vps-cron/settings';

type AccessOk = {
  user: { id: string; email: string | null };
  audit: RequestAuditContext;
};

async function requireVpsCronAdmin(
  request: Request
): Promise<AccessOk | { error: NextResponse }> {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'vps_cron_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const auth = await loadUserAuth(user.id);
  const actorEmail = auth?.profile?.email ?? user.email ?? null;
  if (!canManageVpsCron(auth?.permissions)) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail,
      statusCode: 403,
      reason: 'vps_cron_forbidden',
      metadata: { actorEmail },
    });
    return {
      error: NextResponse.json(
        { error: `Forbidden for email: ${actorEmail ?? 'unknown'}` },
        { status: 403 }
      ),
    };
  }
  return {
    user: { id: user.id, email: actorEmail },
    audit: requestAuditContext(request),
  };
}

export async function GET(request: Request) {
  const access = await requireVpsCronAdmin(request);
  if ('error' in access) return access.error;

  try {
    const jobs = await listVpsCronJobStatus();
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load VPS cron jobs');
  }
}

export async function PATCH(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireVpsCronAdmin(request);
  if ('error' in access) return access.error;

  try {
    const body = (await request.json()) as { jobId?: string; paused?: boolean };
    if (!isVpsCronJobId(body.jobId)) {
      return NextResponse.json({ error: 'Unknown job id' }, { status: 400 });
    }
    if (typeof body.paused !== 'boolean') {
      return NextResponse.json({ error: 'paused must be boolean' }, { status: 400 });
    }

    await setVpsCronPaused(body.jobId, body.paused, access.user.id);
    const jobs = await listVpsCronJobStatus();
    const eventType = body.paused ? 'admin.vps_cron.pause' : 'admin.vps_cron.resume';
    const actionLabel = body.paused ? 'Paused VPS cron job' : 'Resumed VPS cron job';

    await logSecurityEventBestEffort({
      eventType,
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email,
      sessionId: access.audit.sessionId,
      route: access.audit.route,
      method: access.audit.method,
      ip: access.audit.ip,
      userAgent: access.audit.userAgent,
      statusCode: 200,
      targetType: 'vps_cron_job',
      targetId: body.jobId,
      targetLabel: body.jobId,
      metadata: {
        summary: `${actionLabel}: ${body.jobId}`,
        actionLabel,
        jobId: body.jobId,
        paused: body.paused,
      },
    });

    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to update VPS cron job');
  }
}
