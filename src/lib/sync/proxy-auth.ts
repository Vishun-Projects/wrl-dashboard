import 'server-only';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { prisma } from '@/lib/db/prisma';

/**
 * Sync-proxy exposes CRM table reads for db-sync-tool.html.
 * Require SYNC_PROXY_SECRET bearer and/or an admin Supabase session (manage_users).
 */
export async function authorizeSyncProxy(
  request: Request
): Promise<NextResponse | null> {
  const secret = process.env.SYNC_PROXY_SECRET?.trim();
  const authHeader = request.headers.get('Authorization') ?? '';

  if (secret && authHeader === `Bearer ${secret}`) {
    return null;
  }

  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await prisma.getUserPermissions(user.id);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
