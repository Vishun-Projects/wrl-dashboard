import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getPortalAuditPayload,
  portalAuditEtag,
} from '@/features/report/lib/portal-audit-server';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { seesAllOffices } from '@/lib/trhcalls/office-security';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRbac(req, { pageId: 'mis_reports', tabId: 'register' });
    if (!auth.ok) return auth.response;

    const officeIds =
      seesAllOffices(auth.security.isHod, auth.security.assignedOffices)
        ? undefined
        : auth.security.assignedOffices;

    const payload = await getPortalAuditPayload(
      officeIds?.length ? { officeIds } : undefined
    );
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
