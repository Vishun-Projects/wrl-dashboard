import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAccessDenied } from '@/lib/security/audit';
import { canManageVpsCron } from '@/lib/security/audit-access';
import { listMisEmailUserSchedules } from '@/features/mis-email/services/list-user-schedules';
import { jsonSafeError } from '@/lib/api/safe-error';

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_schedules_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const auth = await loadUserAuth(user.id);
  const actorEmail = auth?.profile?.email ?? user.email ?? null;
  if (!canManageVpsCron(auth?.permissions)) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail,
      statusCode: 403,
      reason: 'mis_email_schedules_forbidden',
      metadata: { actorEmail },
    });
    return NextResponse.json(
      { error: `Forbidden for email: ${actorEmail ?? 'unknown'}` },
      { status: 403 }
    );
  }

  try {
    const schedules = await listMisEmailUserSchedules();
    return NextResponse.json({ schedules });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load schedules');
  }
}
