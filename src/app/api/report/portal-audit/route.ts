import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getPortalAuditPayload,
  portalAuditEtag,
} from '@/lib/report/portal-audit-server';
import { resolveRequestUserId } from '@/lib/auth/server-user';

async function authorize(req: NextRequest): Promise<boolean> {
  const supabase = await createClient();
  const userId = await resolveRequestUserId(req, supabase);
  return Boolean(userId);
}

export async function GET(req: NextRequest) {
  try {
    if (!(await authorize(req))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await getPortalAuditPayload();
    const etag = portalAuditEtag(payload);
    const ifNoneMatch = req.headers.get('If-None-Match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    return NextResponse.json(payload, { headers: { ETag: etag } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Portal audit fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
