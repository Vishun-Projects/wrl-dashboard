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
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const account = searchParams.get('account') || '';
    const region = searchParams.get('region') || '';

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

    let condition = "callsntrnno IS NOT NULL AND callsntrnno <> ''";

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
      condition += ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) >= '${startDate}'`;
    }
    if (endDate) {
      condition += ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) <= '${endDate} 23:59:59'`;
    }

    if (account && account !== 'All') {
      const accountNameSafe = account.replace(/'/g, "''");
      condition += ` AND npartyprofile IN (SELECT ncode FROM mstpartyprofile WHERE vname LIKE '%${accountNameSafe}%')`;
    }

    if (callType && callType !== 'All') {
      if (callType.includes(',')) {
        const types = callType.split(',').map(t => `'${t.trim().replace(/'/g, "''")}'`).join(',');
        condition += ` AND calltype IN (${types})`;
      } else {
        condition += ` AND calltype = '${callType.replace(/'/g, "''")}'`;
      }
    }

    if (region && region !== 'All') {
      const regionsArray = region.split(',').map(r => `'${r.replace(/'/g, "''")}'`).join(',');
      condition += ` AND nofficeid IN (
        SELECT o.ncode FROM mstoffice o
        LEFT JOIN mstoffice op ON o.nunder = op.ncode AND o.nunder <> 0
        LEFT JOIN mstzones z ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
        WHERE z.vname IN (${regionsArray})
      )`;
    }

    const topValue = page * limit;
    const [countRes, res, summaryRes] = await Promise.all([
      postQuery({
        fields: "COUNT(callsntrnno) as total",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition
      }),
      postQuery({
        fields: `callsntrnno, callsdtrndate, PartyName, vlocation, itemname, callsvserialno, serviceman, vcomplaint, Status, callstatus, callsolved, Priority, callsolveddate, vsolveremarks, UniqueCallNo, vpersoncalling, vinsttel1, vinstaddress, addedby, officename, calltype, vtransfercallno, vtransferofficename, (SELECT TOP 1 vname FROM mstcallcancelreasons (NOLOCK) WHERE ncode = CAST(NULLIF(ncancelreason, '') AS NVARCHAR(50))) as cancel_reason`,
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition,
        orderBy: "ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) DESC",
        top: String(topValue)
      }),
      postQuery({
        fields: "COUNT(*) as total, SUM(CASE WHEN ISNULL(vtransfercallno, '') <> '' OR CAST(ncancelreason AS NVARCHAR(50)) = '2' THEN 1 ELSE 0 END) as transferred, SUM(CASE WHEN ISNULL(ncancelreason, '') <> '' AND CAST(ncancelreason AS NVARCHAR(50)) <> '0' AND CAST(ncancelreason AS NVARCHAR(50)) <> '2' THEN 1 ELSE 0 END) as cancelled, SUM(CASE WHEN callsolved = 'True' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed' THEN 1 ELSE 0 END) as solved, SUM(CASE WHEN (callsolved = 'False' OR callsolved IS NULL) AND ISNULL(ncancelreason, '') = '' THEN 1 ELSE 0 END) as open_calls",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition
      })
    ]);

    const totalCount = parseInt(countRes.data?.[0]?.total || "0");
    const summary = summaryRes.data?.[0] || { total: 0, transferred: 0, cancelled: 0, solved: 0, open_calls: 0 };

    return NextResponse.json({
      data: res.data || [],
      total: totalCount,
      summary: {
        total: parseInt(summary.total || "0"),
        transferred: parseInt(summary.transferred || "0"),
        cancelled: parseInt(summary.cancelled || "0"),
        solved: parseInt(summary.solved || "0"),
        open: parseInt(summary.open_calls || "0")
      }
    });

  } catch (error: any) {
    console.error('Report API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
