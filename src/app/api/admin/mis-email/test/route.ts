import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSmtpConfigured } from '@/features/mis-email/lib/send';
import { runMisEmailTest } from '@/features/mis-email/lib/run-digest';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { logAccessDenied, logAction } from '@/lib/security/audit';

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_test_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  const actor = {
    userId: user.id,
    email: auth?.profile?.email ?? user.email ?? null,
    name: auth?.profile?.name ?? null,
  };
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: actor.email,
      statusCode: 403,
      reason: 'mis_email_test_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { userId?: string } = {};
  try {
    body = (await request.json()) as { userId?: string };
  } catch {
    /* empty body is fine */
  }

  const started = Date.now();
  const targetUserId = body.userId || user.id;

  try {
    const result = await runMisEmailTest({
      userId: targetUserId,
    });

    await logAction({
      request,
      action: 'admin.mis_email.test',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'app_user', id: targetUserId },
      summary: `Sent MIS email test to ${Array.isArray(result.sentTo) ? result.sentTo.join(', ') : String(result.sentTo ?? '')}`,
      metadata: {
        scopeLabel: result.scopeLabel,
        attachmentCount: Array.isArray(result.attachments) ? result.attachments.length : null,
        durationMs: Date.now() - started,
      },
    });

    return NextResponse.json({
      ok: true,
      sentTo: result.sentTo,
      attachments: result.attachments,
      scopeLabel: result.scopeLabel,
      messageId: result.messageId,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[mis-email/test]', err);
    await logAction({
      request,
      action: 'admin.mis_email.test',
      actor,
      result: 'failure',
      statusCode: 500,
      target: { type: 'app_user', id: targetUserId },
      summary: 'MIS email test failed',
      metadata: { message: toUserFacingError(err) },
    });
    return NextResponse.json(
      { error: toUserFacingError(err) || 'Failed to send test MIS email' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const testTo = process.env.MIS_EMAIL_TEST_TO?.trim() || 'vishnu.vishwakarma@westernequipments.com';
  const masked = testTo.replace(/(.{2}).*(@.*)/, '$1***$2');
  return NextResponse.json({
    testRecipient: masked,
    smtpConfigured: isSmtpConfigured(),
  });
}
