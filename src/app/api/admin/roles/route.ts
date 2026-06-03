import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import {
  groupPermissionsForRolesUi,
  PAGE_PERMISSION_SEED,
} from '@/lib/auth/page-access';

async function ensurePagePermissionsExist(): Promise<void> {
  for (const seed of PAGE_PERMISSION_SEED) {
    await prisma.$queryRawUnsafe(
      `INSERT INTO public.app_permissions (id, name, description)
       SELECT gen_random_uuid(), $1, $2
       WHERE NOT EXISTS (SELECT 1 FROM public.app_permissions WHERE name = $1)`,
      seed.name,
      seed.description
    );
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_roles')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await ensurePagePermissionsExist();

    const roles = await prisma.$queryRawUnsafe(`
      SELECT r.*, 
             COALESCE(json_agg(p.name) FILTER (WHERE p.name IS NOT NULL), '[]') as permissions
      FROM public.app_roles r
      LEFT JOIN public.app_role_permissions rp ON r.id = rp.role_id
      LEFT JOIN public.app_permissions p ON rp.permission_id = p.id
      GROUP BY r.id
      ORDER BY r.name ASC
    `);

    const allPermissions = await prisma.$queryRawUnsafe(
      'SELECT * FROM public.app_permissions ORDER BY name ASC'
    );
    const permissionGroups = groupPermissionsForRolesUi(allPermissions as any[]);

    return NextResponse.json({ roles, allPermissions, permissionGroups });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_roles')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { name, description, permissionIds } = await request.json();

    // 1. Create Role
    const roleResult: any[] = await prisma.$queryRawUnsafe(
      'INSERT INTO public.app_roles (name, description) VALUES ($1, $2) RETURNING id',
      name, description
    );
    const roleId = roleResult[0].id;

    // 2. Add Permissions
    if (permissionIds && permissionIds.length > 0) {
      for (const pId of permissionIds) {
        await prisma.$queryRawUnsafe(
          'INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)',
          roleId, pId
        );
      }
    }

    return NextResponse.json({ success: true, id: roleId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_roles')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id, name, description, permissionIds } = await request.json();

    // 1. Update Role Info
    await prisma.$queryRawUnsafe(
      'UPDATE public.app_roles SET name = $1, description = $2 WHERE id = $3',
      name, description, id
    );

    // 2. Clear and Re-add Permissions
    await prisma.$queryRawUnsafe('DELETE FROM public.app_role_permissions WHERE role_id = $1', id);
    
    if (permissionIds && permissionIds.length > 0) {
      for (const pId of permissionIds) {
        await prisma.$queryRawUnsafe(
          'INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES ($1, $2)',
          id, pId
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permissions = await (prisma as any).getUserPermissions(user.id);
  if (!permissions.includes('manage_roles')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) throw new Error('Role ID is required');

    await prisma.$queryRawUnsafe('DELETE FROM public.app_roles WHERE id = $1', id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
