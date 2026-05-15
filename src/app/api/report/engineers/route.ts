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

    let condition = `officename = '${branch}'`;
    if (startDate && endDate) {
      condition += ` AND callsdtrndate >= '${startDate}' AND callsdtrndate <= '${endDate} 23:59:59'`;
    }
    condition += " AND serviceman IS NOT NULL AND serviceman != ''";

    const res = await postQuery({
      fields: "DISTINCT serviceman",
      tableName: "uv_findtrhcalls_callsearch WITH (NOLOCK)",
      condition: `${condition} ORDER BY serviceman ASC`,
    });

    return NextResponse.json(res.data?.map((r: any) => r.serviceman) || []);

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
