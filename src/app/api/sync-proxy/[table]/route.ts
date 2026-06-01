import { NextResponse } from 'next/server';
import { handleSyncProxyGet, syncProxyOptions } from '@/lib/sync-proxy-route';
import { toUserFacingError } from '@/lib/user-facing-errors';

export async function OPTIONS() {
  return syncProxyOptions();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string }> }
) {
  try {
    const { table } = await params;
    return await handleSyncProxyGet(request, table);
  } catch (error: unknown) {
    console.error('[sync-proxy]', error);
    return NextResponse.json(
      { error: toUserFacingError(error) },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
