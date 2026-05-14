import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Admin operations require service role for auth management
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Check if requester is HOD via raw SQL
  const result: any[] = await prisma.$queryRawUnsafe(
    'SELECT role FROM public.app_users WHERE id = $1 LIMIT 1',
    user.id
  );
  
  if (result?.[0]?.role !== 'hod') {
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
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: any[] = await prisma.$queryRawUnsafe(
    'SELECT role FROM public.app_users WHERE id = $1 LIMIT 1',
    adminUser.id
  );
  if (result?.[0]?.role !== 'hod') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, password, name, role, office_ids, visible_statuses } = body;

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
      'INSERT INTO public.app_users (id, email, name, role, office_ids, visible_statuses) VALUES ($1, $2, $3, $4, $5, $6)',
      authData.user.id, email, name, role, office_ids || [], visible_statuses || []
    );

    return NextResponse.json({ success: true, id: authData.user.id });
  } catch (err: any) {

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: any[] = await prisma.$queryRawUnsafe(
    'SELECT role FROM public.app_users WHERE id = $1 LIMIT 1',
    adminUser.id
  );
  if (result?.[0]?.role !== 'hod') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { id, name, role, office_ids, visible_statuses } = body;

    await prisma.$queryRawUnsafe(
      'UPDATE public.app_users SET name = $1, role = $2, office_ids = $3, visible_statuses = $4 WHERE id = $5',
      name, role, office_ids, visible_statuses || [], id
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: any[] = await prisma.$queryRawUnsafe(
    'SELECT role FROM public.app_users WHERE id = $1 LIMIT 1',
    adminUser.id
  );
  if (result?.[0]?.role !== 'hod') {
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
