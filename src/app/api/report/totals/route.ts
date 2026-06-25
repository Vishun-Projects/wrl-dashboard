import { NextRequest, NextResponse } from 'next/server';
import { handleRegisterGet } from '@/lib/register/server/handler';
import { resolveRegisterPostgresRequest } from '@/lib/register/server/postgres-request';
import { queryRegisterTotalsFromPostgres } from '@/lib/read-model/queries/register';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

async function totalsViaRegisterHandler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  url.pathname = '/api/report';
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '1');
  url.searchParams.set('fetchTotals', 'true');
  url.searchParams.set('fetchFilterOptions', 'false');

  const fallbackReq = new NextRequest(url, { headers: req.headers });
  const response = await handleRegisterGet(fallbackReq);
  if (response.status !== 200) {
    const errBody = await response.json().catch(() => ({}));
    return NextResponse.json(errBody, { status: response.status });
  }

  const body = (await response.json()) as {
    total?: number;
    summary?: unknown;
    readSource?: string;
  };

  const syncMeta = await getSyncMeta();
  return NextResponse.json({
    total: body.total ?? 0,
    summary: body.summary,
    readSource: body.readSource ?? 'crm',
    syncMeta,
  });
}

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveRegisterPostgresRequest(req);
    if (!resolved.ok) {
      if (resolved.response.status === 400) {
        return totalsViaRegisterHandler(req);
      }
      return resolved.response;
    }

    const result = await queryRegisterTotalsFromPostgres(resolved.ctx.params);
    const syncMeta = await getSyncMeta();

    return NextResponse.json({
      ...result,
      readSource: 'postgres',
      syncMeta,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
