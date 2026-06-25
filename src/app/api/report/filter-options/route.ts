import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { handleRegisterGet } from '@/lib/register/server/handler';
import { resolveRegisterPostgresRequest } from '@/lib/register/server/postgres-request';
import { queryRegisterFilterOptionsFromPostgres } from '@/lib/read-model/queries/register';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; payload: unknown }>();

function filterCacheKey(userId: string, params: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 16);
  return `${userId}:${hash}`;
}

async function filterOptionsViaRegisterHandler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  url.pathname = '/api/report';
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('fetchTotals', 'false');
  url.searchParams.set('fetchFilterOptions', 'true');

  const fallbackReq = new NextRequest(url, { headers: req.headers });
  const response = await handleRegisterGet(fallbackReq);
  if (response.status !== 200) {
    const errBody = await response.json().catch(() => ({}));
    return NextResponse.json(errBody, { status: response.status });
  }

  const body = (await response.json()) as {
    statesList?: unknown;
    citiesList?: unknown;
    branchesList?: unknown;
    franchiseesList?: unknown;
    techniciansList?: unknown;
    readSource?: string;
  };

  return NextResponse.json({
    statesList: body.statesList ?? [],
    citiesList: body.citiesList ?? [],
    branchesList: body.branchesList ?? [],
    franchiseesList: body.franchiseesList ?? [],
    techniciansList: body.techniciansList ?? [],
    readSource: body.readSource ?? 'crm',
    cached: false,
  });
}

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveRegisterPostgresRequest(req);
    if (!resolved.ok) {
      if (resolved.response.status === 400) {
        return filterOptionsViaRegisterHandler(req);
      }
      return resolved.response;
    }

    const key = filterCacheKey(resolved.ctx.userId, resolved.ctx.params);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ...(cached.payload as object), cached: true });
    }

    const options = await queryRegisterFilterOptionsFromPostgres(resolved.ctx.params);
    const payload = { ...options, readSource: 'postgres', cached: false };
    cache.set(key, { expiresAt: Date.now() + TTL_MS, payload });

    return NextResponse.json(payload);
  } catch (err: unknown) {
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
