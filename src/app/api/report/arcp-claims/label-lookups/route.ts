import { NextRequest, NextResponse } from 'next/server';
import { authenticateArcpClaimsRequest } from '@/features/arcp/server/route-auth';
import { loadArcpCrmLabelLookups } from '@/features/arcp/server/crm-labels';
import { jsonSafeError } from '@/lib/api/safe-error';

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
    return jsonSafeError(err, 500, 'Failed to load label lookups');
  }
}
