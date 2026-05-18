import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Admin operations require service role for auth management
const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  try {
    const body = await request.json();
    const { email, password, name, role, role_id, office_ids, visible_statuses } = body;

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. User creation aborted.');
    }

    // 1. Create Auth User
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (createError) throw createError;

    // 2. Create Public Profile via raw SQL
    await prisma.$queryRawUnsafe(
      'INSERT INTO public.app_users (id, email, name, role, role_id, office_ids, visible_statuses) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      authData.user.id, email, name, role, role_id, office_ids || [], visible_statuses || []
    );

    return NextResponse.json({ success: true, id: authData.user.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
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

    await prisma.$queryRawUnsafe(
      'UPDATE public.app_users SET name = $1, role = $2, role_id = $3, office_ids = $4, visible_statuses = $5 WHERE id = $6',
      name, role, role_id, office_ids, visible_statuses || [], id
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

    // Prevent self-deletion
    if (userId === adminUser.id) throw new Error('Cannot delete your own account');

    // 1. Delete from Public Profiles
    await prisma.$queryRawUnsafe('DELETE FROM public.app_users WHERE id = $1', userId);

    // 2. Delete from Supabase Auth
    await supabaseAdmin.auth.admin.deleteUser(userId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
