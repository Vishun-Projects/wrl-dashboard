import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isHodUser } from '@/lib/auth/report-security';
import {
  canManageMisEmailRouting,
  listMisEmailRoutingOptions,
  normalizeMisEmailRoutingClientSourceMode,
} from '@/lib/mis-email/routing-rules';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; payload: unknown }>();

function optionsCacheKey(
  userId: string,
  zone: string,
  branch: string,
  clientSourceMode: string
): string {
  const hash = createHash('sha256')
    .update(`${zone}::${branch}::${clientSourceMode}`)
    .digest('hex')
    .slice(0, 16);
  return `${userId}:${hash}`;
}

async function requireHodRoutingAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const auth = await loadUserAuth(user.id);
  if (!auth) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  if (
    !canManageMisEmailRouting({
      role: auth.profile.role,
      office_ids: auth.profile.office_ids ?? [],
      permissions: auth.permissions,
    })
  ) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth, userId: user.id };
}

export async function GET(request: NextRequest) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

  try {
    const zone = request.nextUrl.searchParams.get('zone')?.trim() ?? '';
    const branch = request.nextUrl.searchParams.get('branch')?.trim() ?? '';
    const clientSourceMode = normalizeMisEmailRoutingClientSourceMode(
      request.nextUrl.searchParams.get('clientSourceMode')
    );
    const key = optionsCacheKey(access.userId, zone, branch, clientSourceMode);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ...(cached.payload as object), cached: true });
    }

    const payload = await listMisEmailRoutingOptions({
      zone,
      branch,
      clientSourceMode,
      assignedOffices: access.auth.profile.office_ids ?? [],
      visibleStatuses: access.auth.profile.visible_statuses ?? [],
      isHod: isHodUser(access.auth.profile, access.auth.permissions),
    });
    const response = { ...payload, cached: false };
    cache.set(key, { expiresAt: Date.now() + TTL_MS, payload: response });
    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load routing options';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
