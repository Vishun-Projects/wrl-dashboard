import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSmtpConfigured } from '@/features/mis-email/lib/send';
import { runMisEmailTest } from '@/features/mis-email/lib/run-digest';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { userId?: string } = {};
  try {
    body = (await request.json()) as { userId?: string };
  } catch {
    /* empty body is fine */
  }

  const started = Date.now();

  try {
    const result = await runMisEmailTest({
      userId: body.userId || user.id,
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
