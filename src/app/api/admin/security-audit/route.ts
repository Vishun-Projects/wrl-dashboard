import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { actionLabelFor, listSecurityAuditEvents, logAccessDenied } from '@/lib/security/audit';
import { canViewSecurityAudit } from '@/lib/security/audit-access';

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'security_audit_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  const actorEmail = auth?.profile?.email ?? user.email ?? null;
  if (!canViewSecurityAudit(auth?.permissions)) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail,
      statusCode: 403,
      reason: 'security_audit_forbidden',
      metadata: { actorEmail },
    });
    return NextResponse.json(
      { error: `Forbidden for email: ${actorEmail ?? 'unknown'}` },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const events = await listSecurityAuditEvents({
      eventType: searchParams.get('eventType'),
      actorUserId: searchParams.get('actorUserId'),
      actorEmail: searchParams.get('actorEmail'),
      result: searchParams.get('result'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      limit: Number(searchParams.get('limit') ?? 100),
    });

    const enriched = events.map((row: Record<string, unknown>) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : {};
      const eventType = String(row.event_type ?? '');
      return {
        ...row,
        action_label: String(metadata.actionLabel ?? actionLabelFor(eventType)),
        summary: String(metadata.summary ?? actionLabelFor(eventType)),
        actor_name: metadata.actorName ?? null,
      };
    });

    return NextResponse.json({ events: enriched });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load security audit log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
