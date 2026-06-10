import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getPortalAuditPayload,
  portalAuditEtag,
} from '@/lib/report/portal-audit-server';

async function authorize(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    return !error && !!user;
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && !!user;
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
