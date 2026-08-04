import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isAllowedAvatarUrl, profilePatchSchema } from '@/lib/api/schemas/mutations';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { assertSameOriginMutation } from '@/lib/api/same-origin';

export async function PATCH(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'profile_update_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  const actor = {
    userId: user.id,
    email: auth?.profile?.email ?? user.email ?? null,
    name: auth?.profile?.name ?? null,
  };

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
    const values: unknown[] = [];
    let paramIndex = 1;
    const changed: string[] = [];

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
      changed.push('name');
    }
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramIndex++}`);
      values.push(avatar_url);
      changed.push('avatar_url');
    }
    if (theme !== undefined) {
      updates.push(`theme = $${paramIndex++}`);
      values.push(theme);
      changed.push('theme');
    }

    if (updates.length === 0) {
      return NextResponse.json({ message: 'No changes provided' });
    }

    const beforeRows = (await prisma.$queryRawUnsafe(
      'SELECT name, avatar_url, theme FROM public.app_users WHERE id = $1 LIMIT 1',
      user.id
    )) as Array<{ name: string | null; avatar_url: string | null; theme: string | null }>;
    const before = beforeRows[0] ?? null;

    values.push(user.id);
    const query = `UPDATE public.app_users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    
    await prisma.$queryRawUnsafe(query, ...values);

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (name !== undefined) changes.name = { old: before?.name ?? null, new: name };
    if (avatar_url !== undefined) changes.avatar_url = { old: before?.avatar_url ?? null, new: avatar_url };
    if (theme !== undefined) changes.theme = { old: before?.theme ?? null, new: theme };

    await logAction({
      request,
      action: 'profile.update',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'app_user', id: user.id, label: actor.email },
      summary: `Updated profile fields: ${changed.join(', ')}`,
      metadata: { changed, changes },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Profile update error:', err);
    await logAction({
      request,
      action: 'profile.update',
      actor,
      result: 'failure',
      statusCode: 500,
      summary: 'Profile update failed',
      metadata: { message: err instanceof Error ? err.message : 'Profile update failed' },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Profile update failed') },
      { status: 500 }
    );
  }
}
