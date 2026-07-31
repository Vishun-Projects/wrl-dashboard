import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { assertSameOriginMutation } from '@/lib/api/same-origin';

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const adminUser = await requireRequestUser(request, supabase);

  if (!adminUser) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_user_password_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(adminUser.id);
  const actor = {
    userId: adminUser.id,
    email: auth?.profile?.email ?? adminUser.email ?? null,
    name: auth?.profile?.name ?? null,
  };

  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: adminUser.id,
      actorEmail: actor.email,
      statusCode: 403,
      reason: 'admin_user_password_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (isDevAuthBypass()) {
    await logAction({
      request,
      action: 'admin.user.password_reset',
      actor,
      result: 'failure',
      statusCode: 503,
      summary: 'Admin password reset blocked in dev auth bypass',
    });
    return NextResponse.json(
      {
        error:
          'Admin password reset requires Supabase Admin API over HTTPS. Use Vercel preview or VPN.',
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Missing userId or newPassword' }, { status: 400 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) throw updateError;

    await logAction({
      request,
      action: 'admin.user.password_reset',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'app_user', id: String(userId) },
      summary: `Reset password for user ${userId}`,
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Password update failed';
    console.error('Password update error:', err);
    await logAction({
      request,
      action: 'admin.user.password_reset',
      actor,
      result: 'failure',
      statusCode: 500,
      summary: 'Admin password reset failed',
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Password update failed') }, { status: 500 });
  }
}
