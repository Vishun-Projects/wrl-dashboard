import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/features/arcp/lib/server/route-auth';
import { loadArcpCrmLabelLookups } from '@/features/arcp/lib/server/crm-labels';

export const maxDuration = 60;

let cachedLookups: Awaited<ReturnType<typeof loadArcpCrmLabelLookups>> | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateArcpClaimsRequest(req, { kind: 'agg' });
    if (auth instanceof NextResponse) return auth;

    const now = Date.now();
    if (!cachedLookups || now - cachedAt > CACHE_TTL_MS) {
      cachedLookups = await loadArcpCrmLabelLookups();
      cachedAt = now;
    }

    return NextResponse.json(cachedLookups);
  } catch (err: unknown) {
    console.error('[ARCP Label Lookups] error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load label lookups';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
