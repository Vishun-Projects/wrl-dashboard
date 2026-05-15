import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch unique call types from the report view
    const res = await postQuery({
      fields: "DISTINCT ISNULL(calltype, 'Unknown') as callType",
      tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
      condition: "calltype IS NOT NULL AND calltype <> ''",
      orderBy: "callType ASC"
    });

    const types = (res.data || []).map((row: any) => row.callType);
    return NextResponse.json(types);

  } catch (err: any) {
    console.error('Call Types Fetch Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
