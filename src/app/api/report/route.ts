import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';

function getExactTrnQuery(search: string): string | null {
  const cleaned = search.trim().replace(/-/g, '');
  if (/^[A-Za-z0-9]{3}\d{2}\d+$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

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
    const status = searchParams.get('status') || '';
    const lastSync = searchParams.get('lastSync') || '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const permissions = await (prisma as any).getUserPermissions(user.id);

    // Get user profile for office restrictions
    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('office_ids, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = profile?.office_ids || [];

    const isHod = 
      permissions.includes('view_all_offices') || 
      permissions.includes('view_reports') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    let condition = "callsntrnno IS NOT NULL AND callsntrnno <> ''";

    if (search && search.length > 2) {
      const searchSafe = search.replace(/'/g, "''");
      const exactTrn = getExactTrnQuery(searchSafe);
      if (exactTrn) {
        condition += ` AND (UniqueCallNo = '${exactTrn}')`;
      } else {
        // Global search: ignore all filters (dates, status, etc.) to look up the specific record historically across the entire database
        condition += ` AND (CAST(callsntrnno AS NVARCHAR(50)) LIKE '%${searchSafe}%' OR itemname LIKE '%${searchSafe}%' OR PartyName LIKE '%${searchSafe}%' OR callsvserialno LIKE '%${searchSafe}%' OR UniqueCallNo LIKE '%${searchSafe}%')`;
      }
    } else {
      if (officeId && officeId !== 'All') {
        if (officeId.includes(',')) {
          condition += ` AND nofficeid IN (${officeId})`;
        } else {
          condition += ` AND nofficeid = ${officeId}`;
        }
      } else if (!isHod && assignedOffices.length > 0) {
        condition += ` AND nofficeid IN (${assignedOffices.join(',')})`;
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

      if (status && status !== 'All') {
        if (status === 'Open Unallocated') {
          condition += " AND (nengineer = 0 OR nengineer IS NULL OR CAST(nengineer AS NVARCHAR(50)) = '0') AND (bfastclose = 'False' OR bfastclose IS NULL OR bfastclose = '0') AND (callsolved = 'False' OR callsolved IS NULL OR callsolved = '0') AND ISNULL(callstatus, '') <> 'Cancel'";
        } else if (status === 'Assigned') {
          condition += " AND (nengineer > 0 OR (nengineer IS NOT NULL AND CAST(nengineer AS NVARCHAR(50)) <> '0')) AND (bfastclose = 'False' OR bfastclose IS NULL OR bfastclose = '0') AND (callsolved = 'False' OR callsolved IS NULL OR callsolved = '0') AND ISNULL(callstatus, '') <> 'Cancel'";
        } else if (status === 'Tech. Solve Call') {
          condition += " AND (bfastclose = 'True' OR bfastclose = '1') AND (callsolved = 'False' OR callsolved IS NULL OR callsolved = '0') AND ISNULL(callstatus, '') <> 'Cancel'";
        } else if (status === 'Closed') {
          condition += " AND (callsolved = 'True' OR callsolved = '1' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed')";
        }
      }
    }

    if (lastSync) {
      condition += ` AND (
        ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) >= '${lastSync}'
        OR ISNULL(TRY_CAST(callsolveddate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsolveddate AS NVARCHAR(50)), 10), 104)) >= '${lastSync}'
      )`;

      const res = await postQuery({
        fields: `callsntrnno, callsdtrndate, PartyName, vlocation, itemname, callsvserialno, serviceman, vcomplaint, Status, callstatus, callsolved, Priority, callsolveddate, vsolveremarks, UniqueCallNo, vpersoncalling, vinsttel1, vinstaddress, addedby, officename, calltype, vtransfercallno, vtransferofficename, bfastclose, nengineer, nofficeid, bmreject, horeject, rejectionstatus, vcomment, (SELECT TOP 1 vname FROM mstcallcancelreasons (NOLOCK) WHERE ncode = CAST(NULLIF(ncancelreason, '') AS NVARCHAR(50))) as cancel_reason`,
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition,
        orderBy: "ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) DESC"
      });

      return NextResponse.json({
        data: res.data || [],
        isDelta: true
      });
    }

    const topValue = page * limit;
    const [countRes, res, summaryRes] = await Promise.all([
      postQuery({
        fields: "COUNT(callsntrnno) as total",
        tableName: "uv_findtrhcalls_callsearch (NOLOCK)",
        condition
      }),
      postQuery({
        fields: `callsntrnno, callsdtrndate, PartyName, vlocation, itemname, callsvserialno, serviceman, vcomplaint, Status, callstatus, callsolved, Priority, callsolveddate, vsolveremarks, UniqueCallNo, vpersoncalling, vinsttel1, vinstaddress, addedby, officename, calltype, vtransfercallno, vtransferofficename, bfastclose, nengineer, nofficeid, bmreject, horeject, rejectionstatus, vcomment, (SELECT TOP 1 vname FROM mstcallcancelreasons (NOLOCK) WHERE ncode = CAST(NULLIF(ncancelreason, '') AS NVARCHAR(50))) as cancel_reason`,
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
