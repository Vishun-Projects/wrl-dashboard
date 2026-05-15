import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';
    const officeId = searchParams.get('officeId') || 'All';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get user profile for office restrictions
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('office_ids, role')
      .eq('id', user.id)
      .single();

    const isHod = profile?.role === 'HOD' || profile?.role === 'ADMIN';
    const assignedOffices = profile?.office_ids || [];

    let condition = "1=1";

    if (officeId && officeId !== 'All') {
      if (officeId.includes(',')) {
        condition += ` AND nofficeid IN (${officeId})`;
      } else {
        condition += ` AND nofficeid = ${officeId}`;
      }
    } else if (!isHod && assignedOffices.length > 0) {
      condition += ` AND nofficeid IN (${assignedOffices.join(',')})`;
    }

    if (search && search.length > 2) {
      condition += ` AND (callsntrnno LIKE '%${search}%' OR itemname LIKE '%${search}%' OR PartyName LIKE '%${search}%' OR callsvserialno LIKE '%${search}%')`;
    }

    if (startDate) {
      condition += ` AND callsdtrndate >= '${startDate}'`;
    }
    if (endDate) {
      condition += ` AND callsdtrndate <= '${endDate} 23:59:59'`;
    }

    const topValue = page * limit;
    const [countRes, res] = await Promise.all([
      postQuery({
        fields: "COUNT(callsntrnno) as total",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition
      }),
      postQuery({
        fields: "callsntrnno, callsdtrndate, PartyName, vlocation, itemname, callsvserialno, serviceman, vcomplaint, Status, callstatus, callsolved, Priority, callsolveddate, vsolveremarks, UniqueCallNo, vpersoncalling, vinsttel1, vinstaddress, addedby, officename",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition,
        orderBy: "callsdtrndate DESC",
        top: topValue,
        skip: (page - 1) * limit
      })
    ]);

    const totalCount = parseInt(countRes.data?.[0]?.total || "0");

    return NextResponse.json({
      data: res.data || [],
      total: totalCount
    });

  } catch (error: any) {
    console.error('Report API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
