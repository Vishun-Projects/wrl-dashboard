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

    const { data: profile } = await supabaseAdmin
      .from('app_users')
      .select('role, office_ids')
      .eq('id', user.id)
      .single();

    const allowedRoles = ['super_admin', 'hod', 'admin'];
    if (!profile?.role || !allowedRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden', role: profile?.role }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf'); // explicit aging reference date

    // Build WHERE conditions for trhcalls (c)
    // vtrnno IS NOT NULL = only real transactions
    let baseCondition = "c.vtrnno IS NOT NULL AND c.vtrnno <> ''";

    if (officeId && officeId !== 'All') {
      if (officeId.includes(',')) {
        baseCondition += ` AND c.nofficeid IN (${officeId})`;
      } else {
        baseCondition += ` AND c.nofficeid = ${officeId}`;
      }
    }

    // calltype filter is handled via dedicated joins inside the SQL to populate columns
    let callTypeJoin = '';

    // dtrndate is a native datetime column — no casting needed
    if (startDate) {
      baseCondition += ` AND c.dtrndate >= '${startDate}'`;
    }
    if (endDate) {
      baseCondition += ` AND c.dtrndate <= '${endDate} 23:59:59'`;
    }

    // agingAsOf wins > endDate > today
    const agingDate = agingAsOf
      ? `'${agingAsOf} 23:59:59'`
      : endDate
      ? `'${endDate} 23:59:59'`
      : 'GETDATE()';

    const rawSql = `
      SELECT
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
        t.installation_done
      FROM (
        SELECT
          CASE WHEN GROUPING(npartyprofile) = 1 THEN 'BRANCH_ENG' ELSE 'DATA' END as row_type,
          nofficeid,
          ISNULL(npartyprofile, 0) as npartyprofile,
          COUNT(*) as population,
          SUM(is_breakdown) as total_calls,
          SUM(is_solved) as solved_calls,
          SUM(is_cancelled) as cancelled_calls,
          SUM(is_open) as open_calls,
          SUM(is_age_2) as age_2,
          SUM(is_age_3) as age_3,
          SUM(is_age_7) as age_7,
          SUM(is_age_15) as age_15,
          SUM(is_part_pending) as part_pending,
          COUNT(DISTINCT eng_name) as active_eng_count,
          SUM(is_deployment) as deployment_total,
          SUM(is_deployment_done) as deployment_done,
          SUM(is_installation) as installation_total,
          SUM(is_installation_done) as installation_done
        FROM (
          SELECT
            c.nofficeid,
            c.npartyprofile,
            c.vtrnno,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as is_breakdown,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND c.bsolved = 1 THEN 1 ELSE 0 END) as is_solved,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND c.ncancelreason IS NOT NULL AND c.ncancelreason <> 0 THEN 1 ELSE 0 END) as is_cancelled,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as is_open,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 2 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as is_age_2,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 2 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 7 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as is_age_3,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 7 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as is_age_7,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as is_age_15,
            MAX(CASE WHEN bd_ct.ncode IS NOT NULL AND (c.vsolveremarks LIKE '%PART%' OR c.vcomplaint LIKE '%PART%') THEN 1 ELSE 0 END) as is_part_pending,
            MAX(CASE WHEN dep_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as is_deployment,
            MAX(CASE WHEN dep_ct.ncode IS NOT NULL AND c.bsolved = 1 THEN 1 ELSE 0 END) as is_deployment_done,
            MAX(CASE WHEN ins_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as is_installation,
            MAX(CASE WHEN ins_ct.ncode IS NOT NULL AND c.bsolved = 1 THEN 1 ELSE 0 END) as is_installation_done,
            MAX(u.vname) as eng_name
          FROM trhcalls c (NOLOCK)
          LEFT JOIN mstusers u (NOLOCK) ON c.nengineer = u.ncode
          LEFT JOIN mstfixedselection bd_ct (NOLOCK) ON c.ncalltype = bd_ct.ncode AND bd_ct.vfieldname = 'ncalltype' AND bd_ct.vdisplayvalue = 'BREAKDOWN'
          LEFT JOIN mstfixedselection dep_ct (NOLOCK) ON c.ncalltype = dep_ct.ncode AND dep_ct.vfieldname = 'ncalltype' AND dep_ct.vdisplayvalue = 'DEPLOYMENT'
          LEFT JOIN mstfixedselection ins_ct (NOLOCK) ON c.ncalltype = ins_ct.ncode AND ins_ct.vfieldname = 'ncalltype' AND ins_ct.vdisplayvalue = 'INSTALLATION CALL'
          WHERE ${baseCondition}
          GROUP BY c.nofficeid, c.npartyprofile, c.vtrnno
        ) t_base
        GROUP BY GROUPING SETS ((nofficeid, npartyprofile), (nofficeid))
      ) t
      JOIN mstoffice o (NOLOCK) ON t.nofficeid = o.ncode
      LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
      LEFT JOIN mstzones z (NOLOCK) ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
      LEFT JOIN mstpartyprofile p (NOLOCK) ON t.npartyprofile = p.ncode
      ORDER BY region ASC
    `;

    const rawRes = await postQuery({ rawSql });
    const rawData = rawRes.data || [];

    // Aggregate in Node.js
    const branchMap = new Map();
    const accountMap = new Map();

    rawData.forEach((row: any) => {
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
