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

    // Fetch user profile for role check
    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('role, office_ids')
      .eq('id', user.id)
      .single();

    // Allow hod, super_admin and admin
    const allowedRoles = ['super_admin', 'hod', 'admin'];
    if (!profile?.role || !allowedRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden', role: profile?.role }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let baseCondition = "1=1";
    if (officeId && officeId !== 'All') {
      if (officeId.includes(',')) {
        baseCondition += ` AND nofficeid IN (${officeId})`;
      } else {
        baseCondition += ` AND nofficeid = ${officeId}`;
      }
    }
    if (startDate) {
      baseCondition += ` AND callsdtrndate >= '${startDate}'`;
    }
    if (endDate) {
      baseCondition += ` AND callsdtrndate <= '${endDate} 23:59:59'`;
    }

    const agingDate = endDate ? `'${endDate} 23:59:59'` : 'GETDATE()';

    // Agg-First, Join-Later pattern for maximum performance
    // This aggregates IDs first (fast) and joins names only on the small result set (~1000 rows)
    const rawRes = await postQuery({
      fields: `
        t.row_type,
        ISNULL(UPPER(z.vname), 'OTHER') as region,
        ISNULL(o.vcompanyname, '') as branch,
        ISNULL(p.vname, 'UNCLASSIFIED') as account,
        o.ncode as officeId,
        o.nunder as parentId,
        t.population,
        t.total_calls,
        t.solved_calls,
        t.cancelled_calls,
        t.open_calls,
        t.age_2,
        t.age_3,
        t.age_7,
        t.age_15,
        t.part_pending,
        t.active_eng_count,
        t.deployment_total,
        t.deployment_done,
        t.installation_total,
        t.installation_done`,
      tableName: `(
        -- 1. Account Level Metrics
        SELECT 
          'DATA' as row_type,
          nofficeid, npartyprofile,
          COUNT(DISTINCT callsvserialno) as population,
          COUNT(*) as total_calls,
          SUM(CASE WHEN (callsolved = '1' OR callsolved = 'True' OR callstatus = 'Solved' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed') THEN 1 ELSE 0 END) as solved_calls,
          SUM(CASE WHEN ISNULL(callstatus,'') = 'Cancel' THEN 1 ELSE 0 END) as cancelled_calls,
          SUM(CASE WHEN (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as open_calls,
          SUM(CASE WHEN DATEDIFF(day, callsdtrndate, ${agingDate}) <= 2 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as age_2,
          SUM(CASE WHEN DATEDIFF(day, callsdtrndate, ${agingDate}) > 2 AND DATEDIFF(day, callsdtrndate, ${agingDate}) <= 7 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as age_3,
          SUM(CASE WHEN DATEDIFF(day, callsdtrndate, ${agingDate}) > 7 AND DATEDIFF(day, callsdtrndate, ${agingDate}) <= 15 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as age_7,
          SUM(CASE WHEN DATEDIFF(day, callsdtrndate, ${agingDate}) > 15 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel' THEN 1 ELSE 0 END) as age_15,
          SUM(CASE WHEN vsolveremarks LIKE '%PART%' OR vcomplaint LIKE '%PART%' THEN 1 ELSE 0 END) as part_pending,
          COUNT(DISTINCT serviceman) as active_eng_count,
          SUM(CASE WHEN calltype = 'DEPLOYMENT' THEN 1 ELSE 0 END) as deployment_total,
          SUM(CASE WHEN calltype = 'DEPLOYMENT' AND (callsolved = '1' OR callsolved = 'True' OR callstatus = 'Solved' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed') THEN 1 ELSE 0 END) as deployment_done,
          SUM(CASE WHEN calltype = 'INSTALLATION CALL' THEN 1 ELSE 0 END) as installation_total,
          SUM(CASE WHEN calltype = 'INSTALLATION CALL' AND (callsolved = '1' OR callsolved = 'True' OR callstatus = 'Solved' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed') THEN 1 ELSE 0 END) as installation_done
        FROM uv_findtrhcalls_callsearch
        WHERE ${baseCondition}
        GROUP BY nofficeid, npartyprofile

        UNION ALL

        -- 2. Branch Level Unique Engineers
        SELECT 
          'BRANCH_ENG' as row_type,
          nofficeid, 0 as npartyprofile,
          0 as population, 0 as total_calls, 0 as solved_calls, 0 as cancelled_calls, 0 as open_calls,
          0 as age_2, 0 as age_3, 0 as age_7, 0 as age_15, 0 as part_pending,
          COUNT(DISTINCT serviceman) as active_eng_count,
          0 as deployment_total, 0 as deployment_done, 0 as installation_total, 0 as installation_done
        FROM uv_findtrhcalls_callsearch
        WHERE ${baseCondition}
        GROUP BY nofficeid
      ) t
      JOIN mstoffice o ON t.nofficeid = o.ncode
      LEFT JOIN mstzones z ON o.nzone = z.ncode
      LEFT JOIN mstpartyprofile p ON t.npartyprofile = p.ncode`,
      condition: `1=1`,
      orderBy: `region ASC`
    });

    const rawData = rawRes.data || [];

    // Aggregate in Node.js
    const branchMap = new Map();
    const accountMap = new Map();

    rawData.forEach(row => {
      const isBranchEng = row.row_type === 'BRANCH_ENG';
      
      if (isBranchEng) {
        if (!branchMap.has(row.officeId)) {
          branchMap.set(row.officeId, {
            officeId: row.officeId, parentId: row.parentId, branch: row.branch, region: row.region,
            total_calls: 0, solved_calls: 0, cancelled_calls: 0, open_calls: 0,
            age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0,
            active_eng: 0
          });
        }
        branchMap.get(row.officeId).active_eng = Number(row.active_eng_count);
      } else {
        // Add to branch metrics
        if (!branchMap.has(row.officeId)) {
          branchMap.set(row.officeId, {
            officeId: row.officeId, parentId: row.parentId, branch: row.branch, region: row.region,
            total_calls: 0, solved_calls: 0, cancelled_calls: 0, open_calls: 0,
            age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0,
            active_eng: 0
          });
        }
        const b = branchMap.get(row.officeId);
        b.total_calls += Number(row.total_calls);
        b.solved_calls += Number(row.solved_calls);
        b.cancelled_calls += Number(row.cancelled_calls);
        b.open_calls += Number(row.open_calls);
        b.age_2 += Number(row.age_2);
        b.age_3 += Number(row.age_3);
        b.age_7 += Number(row.age_7);
        b.age_15 += Number(row.age_15);
        b.part_pending += Number(row.part_pending);

        // Add to account metrics
        const aKey = `${row.region}-${row.account}`;
        if (!accountMap.has(aKey)) {
          accountMap.set(aKey, {
            region: row.region, account: row.account,
            population: 0, total_calls: 0, total_solved: 0, cancelled_calls: 0, open_calls: 0,
            age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0,
            deployment_total: 0, deployment_done: 0, installation_total: 0, installation_done: 0,
            active_eng: 0
          });
        }
        const a = accountMap.get(aKey);
        a.population += Number(row.population);
        a.total_calls += Number(row.total_calls);
        a.total_solved += Number(row.solved_calls);
        a.cancelled_calls += Number(row.cancelled_calls);
        a.open_calls += Number(row.open_calls);
        a.age_2 += Number(row.age_2);
        a.age_3 += Number(row.age_3);
        a.age_7 += Number(row.age_7);
        a.age_15 += Number(row.age_15);
        a.part_pending += Number(row.part_pending);
        a.deployment_total += Number(row.deployment_total);
        a.deployment_done += Number(row.deployment_done);
        a.installation_total += Number(row.installation_total);
        a.installation_done += Number(row.installation_done);
        a.active_eng += Number(row.active_eng_count);
      }
    });

    return NextResponse.json({ 
      branchSummary: Array.from(branchMap.values()), 
      accountSummary: Array.from(accountMap.values()) 
    });

  } catch (err: any) {
    console.error('Report Summary Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
