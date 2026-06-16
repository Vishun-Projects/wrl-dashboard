import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isDevAuthBypass()) {
    return NextResponse.json(
      {
        error:
          'Password change requires Supabase Auth over HTTPS. Use Vercel preview, VPN, or change password on production.',
      },
      { status: 503 }
    );
  }

  try {
    const { newPassword } = await request.json();

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Password update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
