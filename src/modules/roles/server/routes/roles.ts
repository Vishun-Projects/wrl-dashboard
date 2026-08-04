import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { groupPermissionsForRolesUi } from '@/lib/auth/rbac-catalog';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { assertSameOriginMutation } from '@/lib/api/same-origin';

const ROLES_CACHE_TTL_MS = 20_000;
const rolesCache = new Map<string, { expiresAt: number; payload: unknown }>();
type PermissionRow = { id: string; name: string; description?: string | null };

function clearRolesCache(): void {
  rolesCache.clear();
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_roles_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  const permissions = auth?.permissions ?? [];

  if (!permissions.includes('manage_roles')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'admin_roles_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const fields = searchParams.get('fields');
    const now = Date.now();
    const cacheKey = `${user.id}:${fields ?? 'full'}`;
    const cached = rolesCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': 'private, max-age=20', 'X-Cache': 'HIT' },
      });
    }

    if (fields === 'minimal') {
      const roles = await prisma.$queryRawUnsafe(
        `SELECT id, name FROM public.app_roles ORDER BY name ASC`
      );
      const payload = { roles };
      rolesCache.set(cacheKey, { payload, expiresAt: now + ROLES_CACHE_TTL_MS });
      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'private, max-age=20', 'X-Cache': 'MISS' },
      });
    }

    const roles = await prisma.$queryRawUnsafe(`
      SELECT r.*, 
             COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') as permissions
      FROM public.app_roles r
      LEFT JOIN public.app_role_permissions rp ON r.id = rp.role_id
      LEFT JOIN public.app_permissions p ON rp.permission_id = p.id
      GROUP BY r.id
      ORDER BY r.name ASC
    `);

    const allPermissions = await prisma.$queryRawUnsafe<PermissionRow[]>(
      'SELECT * FROM public.app_permissions ORDER BY name ASC'
    );
    const permissionGroups = groupPermissionsForRolesUi(allPermissions);

    const payload = { roles, allPermissions, permissionGroups };
    rolesCache.set(cacheKey, { payload, expiresAt: now + ROLES_CACHE_TTL_MS });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=20', 'X-Cache': 'MISS' },
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load roles');
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_roles_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_roles')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'admin_roles_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { name, description, permissionIds } = await request.json();

    const roleResult = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'INSERT INTO public.app_roles (name, description) VALUES ($1, $2) RETURNING id',
      name, description
    );
    const roleId = roleResult[0].id;

    if (permissionIds && permissionIds.length > 0) {
      for (const pId of permissionIds) {
        await prisma.$queryRawUnsafe(
          'INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)',
          roleId, pId
        );
      }
    }

    clearRolesCache();
    const nextPermissionIds = Array.isArray(permissionIds)
      ? permissionIds.map((p: unknown) => String(p))
      : [];
    await logSecurityEventBestEffort({
      eventType: 'admin.role.create',
      result: 'success',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_role',
      targetId: roleId,
      targetLabel: String(name ?? ''),
      metadata: {
        summary: `Created role ${String(name ?? roleId)}`,
        actionLabel: 'Created role',
        permissionCount: nextPermissionIds.length,
        after: {
          name: name ?? null,
          description: description ?? null,
          permissionIds: nextPermissionIds,
        },
      },
    });
    return NextResponse.json({ success: true, id: roleId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Create role failed';
    await logSecurityEventBestEffort({
      eventType: 'admin.role.create',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Create role failed') }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_roles_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_roles')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'admin_roles_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id, name, description, permissionIds } = await request.json();

    const beforePermRows = (await prisma.$queryRawUnsafe(
      'SELECT permission_id FROM public.app_role_permissions WHERE role_id = $1',
      id
    )) as Array<{ permission_id: string }>;
    const beforePermissionIds = beforePermRows.map((r) => String(r.permission_id)).sort();
    const nextPermissionIds = Array.isArray(permissionIds)
      ? permissionIds.map((p: unknown) => String(p)).sort()
      : [];
    const beforeRoleRows = (await prisma.$queryRawUnsafe(
      'SELECT name, description FROM public.app_roles WHERE id = $1 LIMIT 1',
      id
    )) as Array<{ name: string | null; description: string | null }>;
    const beforeRole = beforeRoleRows[0] ?? null;

    await prisma.$queryRawUnsafe(
      'UPDATE public.app_roles SET name = $1, description = $2 WHERE id = $3',
      name, description, id
    );

    await prisma.$queryRawUnsafe('DELETE FROM public.app_role_permissions WHERE role_id = $1', id);

    if (permissionIds && permissionIds.length > 0) {
      for (const pId of permissionIds) {
        await prisma.$queryRawUnsafe(
          'INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)',
          id, pId
        );
      }
    }

    clearRolesCache();
    const added = nextPermissionIds.filter((p) => !beforePermissionIds.includes(p));
    const removed = beforePermissionIds.filter((p) => !nextPermissionIds.includes(p));
    await logSecurityEventBestEffort({
      eventType: 'admin.role.update',
      result: 'success',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_role',
      targetId: String(id),
      targetLabel: String(name ?? ''),
      metadata: {
        summary: `Updated role ${String(name ?? id)}`,
        actionLabel: 'Updated role',
        permissionCount: nextPermissionIds.length,
        changes: {
          name: { old: beforeRole?.name ?? null, new: name },
          description: { old: beforeRole?.description ?? null, new: description },
          permissionIds: { old: beforePermissionIds, new: nextPermissionIds },
          permissionIdsAdded: added,
          permissionIdsRemoved: removed,
        },
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Update role failed';
    await logSecurityEventBestEffort({
      eventType: 'admin.role.update',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Update role failed') }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_roles_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_roles')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'admin_roles_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) throw new Error('Role ID is required');

    const beforeRoleRows = (await prisma.$queryRawUnsafe(
      'SELECT name, description FROM public.app_roles WHERE id = $1 LIMIT 1',
      id
    )) as Array<{ name: string | null; description: string | null }>;
    const beforeRole = beforeRoleRows[0] ?? null;
    const beforePermRows = (await prisma.$queryRawUnsafe(
      'SELECT permission_id FROM public.app_role_permissions WHERE role_id = $1',
      id
    )) as Array<{ permission_id: string }>;
    const beforePermissionIds = beforePermRows.map((r) => String(r.permission_id)).sort();
    const before = beforeRole
      ? {
          name: beforeRole.name,
          description: beforeRole.description,
          permissionIds: beforePermissionIds,
        }
      : null;

    await prisma.$queryRawUnsafe('DELETE FROM public.app_roles WHERE id = $1', id);

    clearRolesCache();
    await logSecurityEventBestEffort({
      eventType: 'admin.role.delete',
      result: 'success',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_role',
      targetId: String(id),
      targetLabel: String(beforeRole?.name ?? id),
      metadata: {
        summary: `Deleted role ${String(beforeRole?.name ?? id)}`,
        actionLabel: 'Deleted role',
        before,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Delete role failed';
    await logSecurityEventBestEffort({
      eventType: 'admin.role.delete',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Delete role failed') }, { status: 500 });
  }
}
