import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';

const USER_COLUMNS = `id, name, email, role, role_id, office_ids, visible_statuses, avatar_url, mis_email_enabled, mis_email_preferences, created_at`;
const BOOTSTRAP_CACHE_TTL_MS = 15_000;
const bootstrapCache = new Map<
  string,
  { expiresAt: number; payload: { users: unknown; roles: unknown; me: unknown; pagination: unknown } }
>();

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
    const cacheKey = `${user.id}:${page}:${limit}`;
    const now = Date.now();
    const cached = bootstrapCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, max-age=15', 'X-Cache': 'HIT' },
      });
    }

    const [users, roles] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT ${USER_COLUMNS} FROM public.app_users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        limit,
        offset
      ),
      prisma.$queryRawUnsafe(
        `SELECT r.id, r.name, r.description,
                COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') AS permissions
         FROM public.app_roles r
         LEFT JOIN public.app_role_permissions rp ON r.id = rp.role_id
         LEFT JOIN public.app_permissions p ON p.id = rp.permission_id
         GROUP BY r.id, r.name, r.description
         ORDER BY r.name ASC`
      ),
    ]);

    const total = Array.isArray(users) ? users.length : 0;
    const payload = {
      users,
      roles,
      me: auth?.profile
        ? {
            ...auth.profile,
            permissions,
          }
        : null,
      pagination: { page, limit, total },
    };
    bootstrapCache.set(cacheKey, { payload, expiresAt: now + BOOTSTRAP_CACHE_TTL_MS });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=15', 'X-Cache': 'MISS' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bootstrap failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
