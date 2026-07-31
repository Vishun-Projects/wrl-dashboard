import { NextRequest, NextResponse } from 'next/server';

import {
  getPortalAuditPayload,
  portalAuditEtag,
} from '@/modules/mis/server/portal-audit-server';
import { jsonSafeError } from '@/lib/api/safe-error';
import { requireRbac } from '@/lib/auth/resolve-bearer-security';
import { seesAllOffices } from '@/sql/trhcalls/office-security';

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
    return jsonSafeError(err, 500, 'Portal audit fetch failed');
  }
}
