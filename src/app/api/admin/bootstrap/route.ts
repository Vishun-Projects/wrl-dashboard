import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { USER_ROLE_IDS_SUBSELECT } from '@/lib/auth/user-roles-sql';
import {
  getAdminBootstrapCache,
  setAdminBootstrapCache,
} from '@/lib/auth/admin-bootstrap-cache';
import { jsonSafeError } from '@/lib/api/safe-error';

const USER_LIST_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.role_id, u.office_ids, u.visible_statuses,
         u.avatar_url, u.mis_email_enabled, u.mis_email_preferences, u.created_at,
         (${USER_ROLE_IDS_SUBSELECT}) AS role_ids
  FROM public.app_users u
  ORDER BY u.created_at DESC
  LIMIT $1 OFFSET $2
`;

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
    const fresh = searchParams.get('fresh') === '1';
    const cacheKey = `${user.id}:${page}:${limit}`;

    if (!fresh) {
      const cached = getAdminBootstrapCache(cacheKey);
      if (cached) {
        return NextResponse.json(cached, {
          headers: { 'Cache-Control': 'private, max-age=15', 'X-Cache': 'HIT' },
        });
      }
    }

    const [users, roles] = await Promise.all([
      prisma.$queryRawUnsafe(USER_LIST_SQL, limit, offset),
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
    setAdminBootstrapCache(cacheKey, payload);

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=15', 'X-Cache': fresh ? 'BYPASS' : 'MISS' },
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Bootstrap failed');
  }
}
