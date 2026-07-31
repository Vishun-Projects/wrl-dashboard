import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import {
  createAuthUserViaDatabase,
  deleteAuthUserViaDatabase,
  findAuthUserIdByEmail,
} from '@/lib/auth/db-create-user';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { safeErrorMessage } from '@/lib/api/safe-error';
import { isDbSignInAvailable } from '@/lib/auth/db-sign-in';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAssignMisEmail, resolveMisEmailReportIncludes } from '@/lib/auth/rbac-catalog';
import { defaultPreferencesForRecipient } from '@/features/mis-email/services/preferences';
import { USER_ROLE_IDS_SUBSELECT } from '@/lib/auth/user-roles-sql';
import {
  loadPermissionsForRoleIds,
  loadRoleNamesByIds,
  normalizeRoleIds,
  replaceUserRoles,
} from '@/lib/auth/user-roles';
import { clearAdminBootstrapCache } from '@/lib/auth/admin-bootstrap-cache';
import { clearMeCache } from '@/lib/auth/me-cache';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

const USER_LIST_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.role_id, u.office_ids, u.visible_statuses,
         u.avatar_url, u.mis_email_enabled, u.mis_email_preferences, u.created_at,
         (${USER_ROLE_IDS_SUBSELECT}) AS role_ids
  FROM public.app_users u
  ORDER BY u.created_at DESC
  LIMIT $1 OFFSET $2
`;



function isDuplicateEmailMessage(message: string): boolean {
  return /already been registered|already registered|already exists|duplicate/i.test(message);
}

function slugRoleName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

async function findAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 50) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function profileExists(userId: string): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    'SELECT id FROM public.app_users WHERE id = $1 LIMIT 1',
    userId
  )) as { id: string }[];
  return rows.length > 0;
}

async function insertAppUser(params: {
  id: string;
  email: string;
  name: string;
  role: string;
  roleId: string;
  roleIds: string[];
  officeIds: string[];
  visibleStatuses: string[];
}) {
  await prisma.$queryRawUnsafe(
    'INSERT INTO public.app_users (id, email, name, role, role_id, office_ids, visible_statuses) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    params.id,
    params.email,
    params.name,
    params.role,
    params.roleId,
    params.officeIds,
    params.visibleStatuses
  );
  await replaceUserRoles(params.id, params.roleIds);
}

async function resolvePrimaryRole(roleIds: string[]): Promise<{
  primaryRoleId: string;
  roleSlug: string;
} | null> {
  if (roleIds.length === 0) return null;
  const names = await loadRoleNamesByIds(roleIds);
  const primaryRoleId = roleIds[0]!;
  const primaryName = names.get(primaryRoleId);
  if (!primaryName) return null;
  return { primaryRoleId, roleSlug: slugRoleName(primaryName) };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_users_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(user.id);
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'admin_users_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '500', 10) || 500));
    const offset = (page - 1) * limit;

    const users = await prisma.$queryRawUnsafe(USER_LIST_SQL, limit, offset);
    return NextResponse.json(users);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load users') },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const adminUser = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!adminUser) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_users_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(adminUser.id);
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      statusCode: 403,
      reason: 'admin_users_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const useDbAuthFallback = isDevAuthBypass() && isDbSignInAvailable();

  let authUserId: string | null = null;
  let createdAuthThisRequest = false;

  try {
    const body = await request.json();
    const { email, password, name, role, role_id, role_ids, office_ids, visible_statuses } = body;
    const roleIds = normalizeRoleIds(role_ids, role_id);
    const primary = await resolvePrimaryRole(roleIds);

    if (!email?.trim() || !password || !name?.trim()) {
      return NextResponse.json({ error: 'Name, email, and password are required.' }, { status: 400 });
    }
    if (!primary) {
      return NextResponse.json({ error: 'Please select at least one system role.' }, { status: 400 });
    }

    const profileParams = {
      email: email.trim(),
      name: name.trim(),
      role: typeof role === 'string' && role.trim() ? role : primary.roleSlug,
      roleId: primary.primaryRoleId,
      roleIds,
      officeIds: office_ids || [],
      visibleStatuses: visible_statuses || [],
    };

    if (useDbAuthFallback) {
      const dbResult = await createAuthUserViaDatabase({
        email: profileParams.email,
        password,
        name: profileParams.name,
      });
      if (!dbResult.ok) {
        if (dbResult.status === 409) {
          const existingId = await findAuthUserIdByEmail(profileParams.email);
          if (existingId && !(await profileExists(existingId))) {
            await insertAppUser({ id: existingId, ...profileParams });
            clearAdminBootstrapCache();
            await logSecurityEventBestEffort({
              eventType: 'admin.user.create',
              result: 'success',
              actorUserId: adminUser.id,
              actorEmail: adminUser.email ?? null,
              sessionId: audit.sessionId,
              route: audit.route,
              method: audit.method,
              ip: audit.ip,
              userAgent: audit.userAgent,
              statusCode: 200,
              targetType: 'app_user',
              targetId: existingId,
              targetLabel: profileParams.email,
              metadata: { recovered: true, roleIds, officeIds: profileParams.officeIds },
            });
            return NextResponse.json({
              success: true,
              id: existingId,
              recovered: true,
              role_ids: roleIds,
            });
          }
        }
        return NextResponse.json({ error: dbResult.message }, { status: dbResult.status });
      }

      authUserId = dbResult.id;
      createdAuthThisRequest = true;
      await insertAppUser({ id: dbResult.id, ...profileParams });
      clearAdminBootstrapCache();
      await logSecurityEventBestEffort({
        eventType: 'admin.user.create',
        result: 'success',
        actorUserId: adminUser.id,
        actorEmail: adminUser.email ?? null,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 200,
        targetType: 'app_user',
        targetId: dbResult.id,
        targetLabel: profileParams.email,
        metadata: { roleIds, officeIds: profileParams.officeIds },
      });
      return NextResponse.json({ success: true, id: dbResult.id, role_ids: roleIds });
    }

    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: profileParams.email,
      password,
      email_confirm: true,
      user_metadata: { name: profileParams.name },
    });

    if (createError) {
      if (isDuplicateEmailMessage(createError.message)) {
        const existing = await findAuthUserByEmail(profileParams.email);
        if (existing && !(await profileExists(existing.id))) {
          authUserId = existing.id;
          await insertAppUser({ id: existing.id, ...profileParams });
          clearAdminBootstrapCache();
          await logSecurityEventBestEffort({
            eventType: 'admin.user.create',
            result: 'success',
            actorUserId: adminUser.id,
            actorEmail: adminUser.email ?? null,
            sessionId: audit.sessionId,
            route: audit.route,
            method: audit.method,
            ip: audit.ip,
            userAgent: audit.userAgent,
            statusCode: 200,
            targetType: 'app_user',
            targetId: existing.id,
            targetLabel: profileParams.email,
            metadata: { recovered: true, roleIds, officeIds: profileParams.officeIds },
          });
          return NextResponse.json({
            success: true,
            id: existing.id,
            recovered: true,
            role_ids: roleIds,
          });
        }
        return NextResponse.json(
          { error: 'A user with this email address is already registered.' },
          { status: 409 }
        );
      }
      throw createError;
    }

    authUserId = authData.user.id;
    createdAuthThisRequest = true;

    await insertAppUser({ id: authData.user.id, ...profileParams });
    clearAdminBootstrapCache();
    await logSecurityEventBestEffort({
      eventType: 'admin.user.create',
      result: 'success',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_user',
      targetId: authData.user.id,
      targetLabel: profileParams.email,
      metadata: { roleIds, officeIds: profileParams.officeIds },
    });

    return NextResponse.json({ success: true, id: authData.user.id, role_ids: roleIds });
  } catch (err: unknown) {
    if (authUserId && createdAuthThisRequest && !(await profileExists(authUserId))) {
      if (useDbAuthFallback) {
        await deleteAuthUserViaDatabase(authUserId).catch(() => {});
      } else {
        await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
      }
    }
    const message = err instanceof Error ? err.message : 'User creation failed';
    const status = isDuplicateEmailMessage(message) ? 409 : 500;
    await logSecurityEventBestEffort({
      eventType: 'admin.user.create',
      result: 'failure',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: status,
      metadata: { message },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, status === 409 ? 'Email already in use' : 'User creation failed') },
      { status }
    );
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const adminUser = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!adminUser) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_users_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(adminUser.id);
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      statusCode: 403,
      reason: 'admin_users_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, name, role, role_id, role_ids, office_ids, visible_statuses, mis_email_enabled } =
      body;
    const roleIds = normalizeRoleIds(role_ids, role_id);
    const primary = await resolvePrimaryRole(roleIds);

    if (!primary) {
      return NextResponse.json({ error: 'Please select at least one system role.' }, { status: 400 });
    }

    const beforeRows = (await prisma.$queryRawUnsafe(
      `SELECT u.name, u.role, u.role_id, u.office_ids, u.visible_statuses, u.mis_email_enabled,
              (${USER_ROLE_IDS_SUBSELECT}) AS role_ids
       FROM public.app_users u
       WHERE u.id = $1
       LIMIT 1`,
      id
    )) as Array<{
      name: string | null;
      role: string | null;
      role_id: string | null;
      office_ids: string[] | null;
      visible_statuses: string[] | null;
      mis_email_enabled: boolean | null;
      role_ids: string[] | null;
    }>;
    const before = beforeRows[0] ?? null;

    const permissions = await loadPermissionsForRoleIds(roleIds);
    const includes = resolveMisEmailReportIncludes(permissions);
    const canEmail = canAssignMisEmail(permissions);
    const wantsEmail = Boolean(mis_email_enabled);
    const roleSlug = typeof role === 'string' && role.trim() ? role : primary.roleSlug;

    if (wantsEmail && !canEmail) {
      return NextResponse.json(
        {
          error:
            'Assign roles with “MIS email reports” plus at least one MIS report tab (or full MIS Reports) before enabling email digests.',
        },
        { status: 400 }
      );
    }

    if (wantsEmail) {
      const { getMisEmailOrgSettings } = await import('@/features/mis-email/services/org-settings');
      const org = await getMisEmailOrgSettings();
      const defaultPrefs = JSON.stringify(
        defaultPreferencesForRecipient(includes, {
          toEmails: org.defaultToEmails,
          ccEmails: org.defaultCcEmails,
          sendTimeIst: org.defaultSendTimeIst,
          dateRange: org.defaultDateRange,
        })
      );
      await prisma.$queryRawUnsafe(
        `UPDATE public.app_users
         SET name = $1, role = $2, role_id = $3, office_ids = $4, visible_statuses = $5,
             mis_email_enabled = true,
             mis_email_preferences = CASE
               WHEN mis_email_preferences = '{}'::jsonb OR mis_email_preferences IS NULL
               THEN $6::jsonb
               ELSE mis_email_preferences
             END
         WHERE id = $7`,
        name,
        roleSlug,
        primary.primaryRoleId,
        office_ids,
        visible_statuses || [],
        defaultPrefs,
        id
      );
    } else {
      await prisma.$queryRawUnsafe(
        `UPDATE public.app_users
         SET name = $1, role = $2, role_id = $3, office_ids = $4, visible_statuses = $5,
             mis_email_enabled = false
         WHERE id = $6`,
        name,
        roleSlug,
        primary.primaryRoleId,
        office_ids,
        visible_statuses || [],
        id
      );
    }

    await replaceUserRoles(id, roleIds);
    clearAdminBootstrapCache();
    clearMeCache(String(id));
    await logSecurityEventBestEffort({
      eventType: 'admin.user.update',
      result: 'success',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_user',
      targetId: String(id),
      metadata: {
        summary: `Updated user ${String(id)}`,
        actionLabel: 'Updated user',
        roleIds,
        officeIds: office_ids,
        visibleStatuses: visible_statuses,
        misEmailEnabled: wantsEmail,
        changes: {
          name: { old: before?.name ?? null, new: name },
          roleIds: { old: before?.role_ids ?? [], new: roleIds },
          office_ids: { old: before?.office_ids ?? [], new: office_ids },
          visible_statuses: {
            old: before?.visible_statuses ?? [],
            new: visible_statuses || [],
          },
          mis_email_enabled: {
            old: Boolean(before?.mis_email_enabled),
            new: wantsEmail,
          },
        },
      },
    });

    return NextResponse.json({ success: true, role_ids: roleIds, role_id: primary.primaryRoleId });
  } catch (err: unknown) {
    await logSecurityEventBestEffort({
      eventType: 'admin.user.update',
      result: 'failure',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { message: err instanceof Error ? err.message : 'Failed to update user' },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update user') },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const adminUser = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!adminUser) {
    await logAccessDenied({ request, statusCode: 401, reason: 'admin_users_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await loadUserAuth(adminUser.id);
  if (!auth?.permissions.includes('manage_users')) {
    await logAccessDenied({
      request,
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      statusCode: 403,
      reason: 'admin_users_forbidden',
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) throw new Error('User ID is required');

    if (userId === adminUser.id) throw new Error('Cannot delete your own account');

    await prisma.$queryRawUnsafe('DELETE FROM public.app_users WHERE id = $1', userId);
    clearAdminBootstrapCache();
    clearMeCache(userId);

    if (isDevAuthBypass()) {
      return NextResponse.json(
        {
          error:
            'Deleting auth users requires Supabase Admin API over HTTPS. Profile row removed; use Vercel to delete auth user.',
          profileDeleted: true,
        },
        { status: 503 }
      );
    }

    await supabaseAdmin.auth.admin.deleteUser(userId);
    await logSecurityEventBestEffort({
      eventType: 'admin.user.delete',
      result: 'success',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_user',
      targetId: userId,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    await logSecurityEventBestEffort({
      eventType: 'admin.user.delete',
      result: 'failure',
      actorUserId: adminUser.id,
      actorEmail: adminUser.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { message: err instanceof Error ? err.message : 'Failed to delete user' },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to delete user') },
      { status: 500 }
    );
  }
}
