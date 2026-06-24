import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';

const USER_COLUMNS = `id, name, email, role, role_id, office_ids, visible_statuses, avatar_url, created_at`;

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  const permissions = auth?.permissions ?? [];

  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '100', 10) || 100));
    const offset = (page - 1) * limit;

    const [users, countRows, roles] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT ${USER_COLUMNS} FROM public.app_users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        limit,
        offset
      ),
      prisma.$queryRawUnsafe<Array<{ total: number }>>(
        `SELECT COUNT(*)::int AS total FROM public.app_users`
      ),
      prisma.$queryRawUnsafe(
        `SELECT id, name FROM public.app_roles ORDER BY name ASC`
      ),
    ]);

    const total = countRows[0]?.total ?? 0;

    return NextResponse.json({
      users,
      roles,
      me: auth?.profile
        ? {
            ...auth.profile,
            permissions,
          }
        : null,
      pagination: { page, limit, total },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bootstrap failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
