import 'server-only';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { resolveUserIdFromAccessToken } from '@/lib/auth/server-user';

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

  const userId = await resolveUserIdFromAccessToken(token);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await prisma.getUserPermissions(userId);
  if (!permissions.includes('manage_users')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
