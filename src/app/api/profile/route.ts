import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, avatar_url } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url);
    }

    if (updates.length === 0) {
      return NextResponse.json({ message: 'No changes provided' });
    }

    values.push(user.id);
    const query = `UPDATE public.app_users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    
    await prisma.$queryRawUnsafe(query, ...values);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Profile update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
