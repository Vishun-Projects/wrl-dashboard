import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const permissions = await (prisma as any).getUserPermissions(user.id);
    if (!permissions.includes('view_reports') && !permissions.includes('view_calls')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    let officeId = searchParams.get('officeId');
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const agingAsOf = searchParams.get('agingAsOf'); // explicit aging reference date

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

    if (!isHod && assignedOffices.length > 0) {
      if (!officeId || officeId === 'All' || officeId === 'undefined' || officeId === 'null') {
        officeId = assignedOffices.join(',');
      } else {
        const requestedIds = officeId.split(',');
        const validIds = requestedIds.filter(id => assignedOffices.includes(Number(id)));
        officeId = validIds.length > 0 ? validIds.join(',') : assignedOffices.join(',');
      }
    }

    // Build WHERE conditions for trhcalls (c)
    // vtrnno IS NOT NULL = only real transactions, but also include transferred calls which might have empty vtrnno but valid vtransfercallno or ncancelreason = 2
    let baseCondition = "((c.vtrnno IS NOT NULL AND c.vtrnno <> '') OR (c.ncancelreason = 2 OR (c.vtransfercallno IS NOT NULL AND c.vtransfercallno <> '')))";

    if (officeId && officeId !== 'All' && officeId !== 'undefined' && officeId !== 'null') {
      if (officeId.includes(',')) {
        baseCondition += ` AND c.nofficeid IN (${officeId})`;
      } else {
        baseCondition += ` AND c.nofficeid = ${officeId}`;
      }
    }

    if (callType && callType !== 'All' && callType !== 'undefined' && callType !== 'null') {
      if (callType.includes(',')) {
        const types = callType.split(',').map(t => `'${t.trim().replace(/'/g, "''")}'`).join(',');
        baseCondition += ` AND c.ncalltype IN (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue IN (${types}))`;
      } else {
        baseCondition += ` AND c.ncalltype = (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue = '${callType.replace(/'/g, "''")}')`;
      }
    }

    // dtrndate is a native datetime column — no casting needed
    if (startDate) {
      baseCondition += ` AND c.dtrndate >= '${startDate}'`;
    }
    if (endDate) {
      baseCondition += ` AND c.dtrndate <= '${endDate} 23:59:59'`;
    }

    // agingAsOf wins > endDate > today. Safely parse to ensure clean YYYY-MM-DD 23:59:59 formatting.
    const agingDate = (() => {
      if (agingAsOf) {
        const d = new Date(agingAsOf);
        if (!isNaN(d.getTime())) {
          return `'${d.toISOString().split('T')[0]} 23:59:59'`;
        }
      }
      if (endDate) {
        return `'${endDate} 23:59:59'`;
      }
      return 'GETDATE()';
    })();

    const subqueryCondition = startDate ? `WHERE dtrndate >= '${startDate}'` : "";    // Collapsed and highly optimized single-level group by query
    const rawSql = `
      SELECT
        ISNULL(UPPER(z.vname), 'OTHER') as region,
        ISNULL(o.vcompanyname, '') as branch,
        ISNULL(p.vname, 'UNCLASSIFIED') as account,
        o.ncode as officeId,
        o.nunder as parentId,
        hc.branch_headcount,
        COUNT(*) as population,
        COUNT(*) as all_total,
        SUM(CASE WHEN c.bsolved = 1 OR c.bfastclose = 1 THEN 1 ELSE 0 END) as all_solved,
        SUM(CASE WHEN c.ncancelreason IS NOT NULL AND c.ncancelreason <> 0 AND c.ncancelreason <> 2 THEN 1 ELSE 0 END) as all_cancelled,
        SUM(CASE WHEN ISNULL(c.vtransfercallno, '') <> '' OR c.ncancelreason = 2 THEN 1 ELSE 0 END) as all_transferred,
        SUM(CASE WHEN (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as all_open,
        SUM(CASE WHEN DATEDIFF(day, c.dtrndate, ${agingDate}) <= 2 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as all_age_2,
        SUM(CASE WHEN DATEDIFF(day, c.dtrndate, ${agingDate}) > 2 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 7 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as all_age_3,
        SUM(CASE WHEN DATEDIFF(day, c.dtrndate, ${agingDate}) > 7 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as all_age_7,
        SUM(CASE WHEN DATEDIFF(day, c.dtrndate, ${agingDate}) > 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as all_age_15,
        SUM(CASE WHEN (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) AND (c.vsolveremarks LIKE '%PART%' OR (c.vcomplaint LIKE '%PART%' AND (c.vcomplaint NOT LIKE 'Cut off, cooling, part problem%' OR v_exist.has_visit = 1))) THEN 1 ELSE 0 END) as all_part_pending,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as total_calls,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND (c.bsolved = 1 OR c.bfastclose = 1) THEN 1 ELSE 0 END) as solved_calls,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND c.bfastclose = 1 THEN 1 ELSE 0 END) as tech_solved_calls,
        SUM(CASE WHEN c.bfastclose = 1 THEN 1 ELSE 0 END) as all_tech_solved,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND c.ncancelreason IS NOT NULL AND c.ncancelreason <> 0 AND c.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled_calls,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND (ISNULL(c.vtransfercallno, '') <> '' OR c.ncancelreason = 2) THEN 1 ELSE 0 END) as transferred_calls,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 2 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as age_2,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 2 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 7 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as age_3,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 7 AND DATEDIFF(day, c.dtrndate, ${agingDate}) <= 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as age_7,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND DATEDIFF(day, c.dtrndate, ${agingDate}) > 15 AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) THEN 1 ELSE 0 END) as age_15,
        SUM(CASE WHEN bd_ct.ncode IS NOT NULL AND (c.bsolved = 0 OR c.bsolved IS NULL) AND (c.bfastclose = 0 OR c.bfastclose IS NULL) AND (c.ncancelreason IS NULL OR c.ncancelreason = 0) AND (c.vsolveremarks LIKE '%PART%' OR (c.vcomplaint LIKE '%PART%' AND (c.vcomplaint NOT LIKE 'Cut off, cooling, part problem%' OR v_exist.has_visit = 1))) THEN 1 ELSE 0 END) as part_pending,
        SUM(CASE WHEN dep_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as deployment_total,
        SUM(CASE WHEN dep_ct.ncode IS NOT NULL AND (c.bsolved = 1 OR c.bfastclose = 1) THEN 1 ELSE 0 END) as deployment_done,
        SUM(CASE WHEN ins_ct.ncode IS NOT NULL THEN 1 ELSE 0 END) as installation_total,
        SUM(CASE WHEN ins_ct.ncode IS NOT NULL AND (c.bsolved = 1 OR c.bfastclose = 1) THEN 1 ELSE 0 END) as installation_done,
        ISNULL(u.vname, '') as technician_name
      FROM (
        SELECT *
        FROM (
          SELECT *,
                  ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
                    ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
                  ) as rn
          FROM trhcalls (NOLOCK)
          ${subqueryCondition}
        ) s
        WHERE s.rn = 1
      ) c
      JOIN mstoffice o (NOLOCK) ON c.nofficeid = o.ncode
      LEFT JOIN mstusers u (NOLOCK) ON c.nengineer = u.ncode
      LEFT JOIN mstfixedselection bd_ct (NOLOCK) ON c.ncalltype = bd_ct.ncode AND bd_ct.vfieldname = 'ncalltype' AND bd_ct.vdisplayvalue = 'BREAKDOWN'
      LEFT JOIN mstfixedselection dep_ct (NOLOCK) ON c.ncalltype = dep_ct.ncode AND dep_ct.vfieldname = 'ncalltype' AND dep_ct.vdisplayvalue = 'DEPLOYMENT'
      LEFT JOIN mstfixedselection ins_ct (NOLOCK) ON c.ncalltype = ins_ct.ncode AND ins_ct.vfieldname = 'ncalltype' AND ins_ct.vdisplayvalue = 'INSTALLATION CALL'
      LEFT JOIN (
        SELECT nofficeid, COUNT(DISTINCT ncode) as branch_headcount
        FROM mstusers (NOLOCK)
        WHERE bactive = 'True'
        GROUP BY nofficeid
      ) hc ON o.ncode = hc.nofficeid
      LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
      LEFT JOIN mstzones z (NOLOCK) ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
      LEFT JOIN mstpartyprofile p (NOLOCK) ON c.npartyprofile = p.ncode
      OUTER APPLY (
        SELECT TOP 1 1 as has_visit 
        FROM trdcalls1visit v (NOLOCK) 
        WHERE v.ncalls = c.ncode
      ) v_exist
      WHERE ${baseCondition}
      GROUP BY
        ISNULL(UPPER(z.vname), 'OTHER'),
        ISNULL(o.vcompanyname, ''),
        ISNULL(p.vname, 'UNCLASSIFIED'),
        o.ncode,
        o.nunder,
        hc.branch_headcount,
        c.nofficeid,
        u.vname
      ORDER BY region ASC
    `;

    const rawRes = await postQuery({ rawSql });
    const rawData = rawRes.data || [];

    // Aggregate in Node.js
    const branchMap = new Map();
    const accountMap = new Map();
    const regionHeadcountMap = new Map();

    rawData.forEach((row: any) => {
      if (!branchMap.has(row.officeId)) {
        branchMap.set(row.officeId, {
          officeId: row.officeId, parentId: row.parentId, branch: row.branch, region: row.region,
          total_calls: 0, solved_calls: 0, cancelled_calls: 0, open_calls: 0, transferred_calls: 0,
          age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0,
          all_total: 0, all_solved: 0, all_cancelled: 0, all_open: 0, all_transferred: 0,
          all_age_2: 0, all_age_3: 0, all_age_7: 0, all_age_15: 0, all_part_pending: 0,
          all_tech_solved: 0, tech_solved_calls: 0,
          deployment_total: 0, deployment_done: 0, installation_total: 0, installation_done: 0,
          active_eng: 0, population: 0, headcount: Number(row.branch_headcount || 0),
          active_eng_names: new Set()
        });
        // Update regional headcount total
        const currentHc = regionHeadcountMap.get(row.region) || 0;
        regionHeadcountMap.set(row.region, currentHc + Number(row.branch_headcount || 0));
      }
      const b = branchMap.get(row.officeId);
      b.population += Number(row.population);
      b.total_calls += Number(row.all_total);
      b.solved_calls += Number(row.all_solved);
      b.all_tech_solved += Number(row.all_tech_solved || 0);
      b.tech_solved_calls += Number(row.tech_solved_calls || 0);
      b.cancelled_calls += Number(row.all_cancelled);
      b.transferred_calls += Number(row.all_transferred);
      b.open_calls += Number(row.all_open);
      b.age_2 += Number(row.all_age_2);
      b.age_3 += Number(row.all_age_3);
      b.age_7 += Number(row.all_age_7);
      b.age_15 += Number(row.all_age_15);
      b.part_pending += Number(row.all_part_pending);

      b.deployment_total += Number(row.deployment_total);
      b.deployment_done += Number(row.deployment_done);
      b.installation_total += Number(row.installation_total);
      b.installation_done += Number(row.installation_done);

      if (row.technician_name && row.technician_name.trim() !== '') {
        b.active_eng_names.add(row.technician_name);
      }

      const aKey = `${row.region}-${row.account}`;
      if (!accountMap.has(aKey)) {
        accountMap.set(aKey, {
          region: row.region, account: row.account,
          population: 0, total_calls: 0, total_solved: 0, cancelled_calls: 0, open_calls: 0, transferred_calls: 0,
          age_2: 0, age_3: 0, age_7: 0, age_15: 0, part_pending: 0,
          deployment_total: 0, deployment_done: 0, installation_total: 0, installation_done: 0,
          active_eng: 0, active_eng_names: new Set(), headcount: 0,
          total_tech_solved: 0
        });
      }
      const a = accountMap.get(aKey);
      a.population += Number(row.population);
      a.total_calls += Number(row.total_calls);
      a.total_solved += Number(row.solved_calls);
      a.total_tech_solved += Number(row.tech_solved_calls || 0);
      a.cancelled_calls += Number(row.cancelled_calls);
      a.transferred_calls += Number(row.transferred_calls);
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
      
      if (row.technician_name && row.technician_name.trim() !== '') {
        a.active_eng_names.add(row.technician_name);
      }
    });

    // Finalize branch active counts
    const branchResults = Array.from(branchMap.values()).map(b => {
      const { active_eng_names, ...rest } = b;
      return {
        ...rest,
        active_eng: active_eng_names.size
      };
    });

    // Finalize account active counts and assign regional headcount
    const accountResults = Array.from(accountMap.values()).map(a => {
      const { active_eng_names, ...rest } = a;
      return {
        ...rest,
        active_eng: active_eng_names.size,
        headcount: regionHeadcountMap.get(a.region) || 0 // Every row in the same region gets the same total headcount
      };
    });

    const globalHeadcount = Array.from(regionHeadcountMap.values()).reduce((sum, val) => sum + val, 0);

    return NextResponse.json({
      branchSummary: branchResults,
      accountSummary: accountResults,
      globalHeadcount
    });

  } catch (err: any) {
    console.error('Report Summary Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
