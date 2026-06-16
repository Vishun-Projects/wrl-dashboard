import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { readDimsFromPostgres } from '@/lib/read-model/flags';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { resolveUserIdFromAccessToken } from '@/lib/auth/server-user';
import { queryCallTypesFromPostgres } from '@/lib/read-model/queries/dims';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const userId = await resolveUserIdFromAccessToken(token);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveReportSecurity(userId, { pagePermission: 'page_mis_reports' });
    if (security.forbidden || (!security.isHod && security.assignedOffices.length === 0)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (readDimsFromPostgres()) {
      const types = await queryCallTypesFromPostgres();
      return NextResponse.json(types);
    }

    const res = await postQuery({
      fields: "DISTINCT fs.vdisplayvalue as callType",
      tableName: "mstfixedselection fs (NOLOCK)",
      condition: "fs.vfieldname = 'ncalltype' AND fs.vdisplayvalue IS NOT NULL AND fs.vdisplayvalue <> '' AND EXISTS (SELECT 1 FROM trhcalls tc (NOLOCK) WHERE tc.ncalltype = fs.ncode)",
      orderBy: "callType ASC"
    });

    const types = (res.data || []).map((row: any) => row.callType);
    return NextResponse.json(types);

  } catch (err: any) {
    console.error('Call Types Fetch Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
