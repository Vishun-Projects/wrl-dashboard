import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

function normalizeUuid(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function isDuplicateEmailMessage(message: string): boolean {
  return /already been registered|already registered|already exists|duplicate/i.test(message);
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
  roleId: string | null;
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
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const users = await prisma.$queryRawUnsafe('SELECT * FROM public.app_users ORDER BY created_at DESC');
    return NextResponse.json(users);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(adminUser.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let authUserId: string | null = null;
  let createdAuthThisRequest = false;

  try {
    const body = await request.json();
    const { email, password, name, role, role_id, office_ids, visible_statuses } = body;
    const roleId = normalizeUuid(role_id);

    if (!email?.trim() || !password || !name?.trim()) {
      return NextResponse.json({ error: 'Name, email, and password are required.' }, { status: 400 });
    }
    if (!roleId) {
      return NextResponse.json({ error: 'Please select a system role.' }, { status: 400 });
    }

    const profileParams = {
      email: email.trim(),
      name: name.trim(),
      role,
      roleId,
      officeIds: office_ids || [],
      visibleStatuses: visible_statuses || [],
    };

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
          return NextResponse.json({ success: true, id: existing.id, recovered: true });
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

    return NextResponse.json({ success: true, id: authData.user.id });
  } catch (err: any) {
    if (authUserId && createdAuthThisRequest && !(await profileExists(authUserId))) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    }
    const message = err?.message || 'User creation failed';
    const status = isDuplicateEmailMessage(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(adminUser.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, name, role, role_id, office_ids, visible_statuses } = body;
    const roleId = normalizeUuid(role_id);

    if (!roleId) {
      return NextResponse.json({ error: 'Please select a system role.' }, { status: 400 });
    }

    await prisma.$queryRawUnsafe(
      'UPDATE public.app_users SET name = $1, role = $2, role_id = $3, office_ids = $4, visible_statuses = $5 WHERE id = $6',
      name,
      role,
      roleId,
      office_ids,
      visible_statuses || [],
      id
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser();

  if (authError || !adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await (prisma as any).getUserPermissions(adminUser.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) throw new Error('User ID is required');

    if (userId === adminUser.id) throw new Error('Cannot delete your own account');

    await prisma.$queryRawUnsafe('DELETE FROM public.app_users WHERE id = $1', userId);

    await supabaseAdmin.auth.admin.deleteUser(userId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
