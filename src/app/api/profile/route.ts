import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isAllowedAvatarUrl, profilePatchSchema } from '@/lib/api/schemas/mutations';

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = profilePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
    }

    const { name, avatar_url, theme } = parsed.data;

    if (avatar_url && !isAllowedAvatarUrl(avatar_url)) {
      return NextResponse.json({ error: 'avatar_url host is not allowed' }, { status: 400 });
    }

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
    if (theme !== undefined) {
      updates.push(`theme = $${paramIndex++}`);
      values.push(theme);
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
