import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check if requester is HOD
  const result: any[] = await prisma.$queryRawUnsafe(
    'SELECT role FROM public.app_users WHERE id = $1 LIMIT 1',
    adminUser.id
  );
  if (result?.[0]?.role !== 'hod') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { userId, newPassword } = body;

    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Missing userId or newPassword' }, { status: 400 });
    }

    // Update password using admin client
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Password update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
