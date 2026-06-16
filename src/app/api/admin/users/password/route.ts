import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createClient();
  const adminUser = await requireRequestUser(request, supabase);

  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(adminUser.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (isDevAuthBypass()) {
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

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Password update failed';
    console.error('Password update error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
