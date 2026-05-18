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

    const { searchParams } = new URL(req.url);
    const branch = searchParams.get('branch');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!branch) return NextResponse.json({ error: 'Branch is required' }, { status: 400 });

    const branchSafe = branch.replace(/'/g, "''");
    let condition = `o.vcompanyname = '${branchSafe}' AND u.vname IS NOT NULL AND u.vname <> ''`;
    if (startDate && endDate) {
      condition += ` AND tc.dtrndate >= '${startDate}' AND tc.dtrndate <= '${endDate} 23:59:59'`;
    }

    const res = await postQuery({
      fields: "DISTINCT u.vname as serviceman",
      tableName: "trhcalls tc (NOLOCK) JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode",
      condition: `${condition} ORDER BY serviceman ASC`,
    });

    return NextResponse.json(res.data?.map((r: any) => r.serviceman) || []);

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
