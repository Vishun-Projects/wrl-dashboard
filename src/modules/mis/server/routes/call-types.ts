import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { readDimsFromPostgres } from '@/lib/read-model/flags';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { queryCallTypesFromPostgres } from '@/sql/read-model/dims';
import { safeErrorMessage } from '@/lib/api/safe-error';

export async function GET(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      shared: true,
    });
    if (!auth.ok) return auth.response;

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

    const types = (res.data || []).map((row) => row.callType);
    return NextResponse.json(types);

  } catch (err: unknown) {
    console.error('Call Types Fetch Error:', err);
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load call types') },
      { status: 500 }
    );
  }
}
