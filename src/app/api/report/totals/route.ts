import { NextRequest, NextResponse } from 'next/server';
import { resolveRegisterPostgresRequest } from '@/features/register/server/postgres-request';
import { queryRegisterTotalsFromPostgres } from '@/lib/read-model/queries/register';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveRegisterPostgresRequest(req);
    if (!resolved.ok) {
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
