import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const priority = searchParams.get('priority');
  const statusFilter = searchParams.get('status');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const search = searchParams.get('search');
  const lastSync = searchParams.get('lastSync');

  try {
    const permissions = await (prisma as any).getUserPermissions(user.id);

    const { data: profile } = await supabase
      .from('app_users')
      .select('office_ids, visible_statuses, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = profile?.office_ids || [];
    const visibleStatuses = profile?.visible_statuses || [];

    const isHod = 
      permissions.includes('view_all_offices') || 
      permissions.includes('view_reports') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    // 2. Build CRM Condition
    let condition = "(tc.ncancelreason IS NULL OR tc.ncancelreason = 0 OR tc.ncancelreason = 2)"; // Exclude cancelled, but include transferred

    if (search && search.length > 2) {
      const searchSafe = search.replace(/'/g, "''");
      const exactTrn = getExactTrnQuery(searchSafe);
      if (exactTrn) {
        condition += ` AND (tc.vtrnno = '${exactTrn}' OR tc.vtransfercallno = '${exactTrn}')`;
      } else {
        // Global search: ignore formatting like dashes, and match reference, serial, customer, branch, tech, complaint, or ID
        condition += ` AND (
          REPLACE(tc.vtrnno, '-', '') LIKE '%${searchSafe}%' 
          OR tc.vtrnno LIKE '%${searchSafe}%' 
          OR tc.vtransfercallno LIKE '%${searchSafe}%'
          OR tc.vserialno LIKE '%${searchSafe}%'
          OR tc.vcomplaint LIKE '%${searchSafe}%'
          OR p.vname LIKE '%${searchSafe}%'
          OR o.vcompanyname LIKE '%${searchSafe}%'
          OR u.vname LIKE '%${searchSafe}%'
          OR CAST(tc.ncode AS NVARCHAR(50)) LIKE '%${searchSafe}%'
        )`;
      }
    } else {
      if (!isHod) {
        if (officeId && officeId !== 'All') {
          if (!assignedOffices.includes(officeId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
          }
          condition += ` AND tc.nofficeid = ${officeId}`;
        } else if (assignedOffices.length > 0) {
          condition += ` AND tc.nofficeid IN (${assignedOffices.join(',')})`;
        }
      } else if (officeId && officeId !== 'All' && officeId !== 'undefined') {
        condition += ` AND tc.nofficeid = ${officeId}`;
      }

      if (priority === 'major') {
        condition += " AND EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
      }
      if (priority === 'minor') {
        condition += " AND NOT EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
      }

      // Filter by Date
      if (startDate && endDate) {
        condition += ` AND ISNULL(TRY_CAST(tc.dtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(tc.dtrndate AS NVARCHAR(50)), 10), 104)) >= '${startDate}' AND ISNULL(TRY_CAST(tc.dtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(tc.dtrndate AS NVARCHAR(50)), 10), 104)) <= '${endDate} 23:59:59'`;
      }
    }

    // Filter by Status (Skipped if search is active)
    if (!search) {
      if (!isHod && visibleStatuses.length > 0) {
        // Restricted user visibility
        if (statusFilter && statusFilter !== 'All') {
          if (!visibleStatuses.includes(statusFilter)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
          }
          // Use standard filter logic for the allowed status
          if (statusFilter === 'Open Unallocated') {
            condition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
          } else if (statusFilter === 'Assigned') {
            condition += " AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
          } else if (statusFilter === 'Tech. Solve Call') {
            condition += " AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
          } else if (statusFilter === 'Closed') {
            condition += " AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed')";
          }
        } else {
          // 'All' requested - combine all allowed statuses
          const statusConditions = (visibleStatuses as string[]).map((s: string) => {
            if (s === 'Open Unallocated') return "((tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel')";
            if (s === 'Assigned') return "((tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel')";
            if (s === 'Tech. Solve Call') return "((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel')";
            if (s === 'Closed') return "((tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed'))";
            return "1=0";
          });
          condition += ` AND (${statusConditions.join(' OR ')})`;
        }
      } else if (statusFilter && statusFilter !== 'All') {
        // Standard HOD/Global filter
        if (statusFilter === 'Open Unallocated') {
          condition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
        }
        if (statusFilter === 'Assigned') {
          condition += " AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
        }
        if (statusFilter === 'Tech. Solve Call') {
          condition += " AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND ISNULL(tc.callstatus, '') <> 'Cancel'";
        }
        if (statusFilter === 'Closed') {
          condition += " AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed')";
        }
      }
    }

    if (lastSync) {
      condition += ` AND (
        ISNULL(TRY_CAST(tc.editedon AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(tc.editedon AS NVARCHAR(50)), 10), 104)) >= '${lastSync}'
        OR ISNULL(TRY_CAST(tc.dtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(tc.dtrndate AS NVARCHAR(50)), 10), 104)) >= '${lastSync}'
      )`;

      const crmRes = await postQuery({
        fields: `tc.ncode, tc.vtrnno, tc.vtransfercallno, tc.nofficeid, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.approvedon, 126) as approvedon, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, p.vname as customer_name, o.vcompanyname as branch_name, tc.vcomplaint, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.vsolveremarks, tc.vpersoncalling, cr.vname as ncancelreason, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, tc.vserialno, tc.vlocation, tc.vcclid, tc.vmanualjobno, u.vname as engineer_name, tc.npriority, tc.bapproval, CONVERT(varchar(30), tc.editedon, 126) as editedon, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime, (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) as is_major_repair, (SELECT COUNT(*) FROM trdcalls3parts tp (NOLOCK) WHERE tp.ncalls = tc.ncode AND tp.nofficeid = tc.nofficeid) as part_count`,
        tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
        condition,
        orderBy: `tc.ncode DESC`
      });

      if (!crmRes.data || crmRes.data.length === 0) {
        return NextResponse.json({ data: [], isDelta: true });
      }

      const callIds = crmRes.data.map((c: any) => String(c.ncode));
      const [flagsRes, commentsRes] = await Promise.all([
        supabaseAdmin.from('call_flags').select('*').in('call_id', callIds),
        supabaseAdmin.from('call_comments').select('*').in('call_id', callIds).order('created_at', { ascending: false })
      ]);

      const flags = flagsRes.data || [];
      const comments = commentsRes.data || [];

      const mergedData = crmRes.data.map((c: any) => {
        const id = String(c.ncode);
        const callFlag = flags.find(f => f.call_id === id);
        const callComments = comments.filter(cm => cm.call_id === id).map(cm => ({
          author_name: cm.author_name,
          comment: cm.comment || cm.content,
          created_at: cm.created_at
        }));

        let statusLabel = 'Open Unallocated';
        if (c.ncancelreason && String(c.ncancelreason) === '2') statusLabel = 'Transferred';
        else if (c.ncancelreason && c.ncancelreason !== '' && c.ncancelreason !== '0') statusLabel = 'Cancelled Call';
        else if (c.bsolved === 'True' || c.bsolved === 1 || c.bsolved === true) {
          const isRejected = String(c.bBMreject).toLowerCase() === 'true' || String(c.bBMreject) === '1' || c.bBMreject === true || c.bBMreject === 1;
          statusLabel = isRejected ? 'Closed - Rejected' : 'Closed';
        }
        else if (c.bfastclose === 'True' || c.bfastclose === 1 || c.bfastclose === true) statusLabel = 'Tech. Solve Call';
        else if (c.baccepted === 'True' || c.baccepted === 1 || c.baccepted === true) statusLabel = 'Allocated - Accepted';
        else if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') statusLabel = 'Assigned - Acceptance Pending';

        return {
          ...c,
          id,
          status_label: statusLabel,
          office_id: String(c.nofficeid),
          audit_flag: callFlag?.flag_type || null,
          comments: callComments,
          visit_count: 0,
          part_count: Number(c.part_count) || 0,
          logged_at: c.dtrndate,
          started_at: c.dallocationdatetime || null,
          resolved_at: c.dfastclosedatetime || c.dsolvedatetime || null,
          approved_at: (String(c.bapproval).toLowerCase() === 'true' || String(c.bapproval) === '1' || c.bapproval === true || c.bapproval === 1) ? (c.editedon || c.approvedon) : null,
          rejected_at: (String(c.bBMreject).toLowerCase() === 'true' || String(c.bBMreject) === '1' || c.bBMreject === true || c.bBMreject === 1) ? c.dBMrejectdatetime : null,
          reject_reason: c.vBMrejectreason || null,
          solve_remarks: c.vsolveremarks || null,
          cancel_reason: c.ncancelreason || null
        };
      });

      return NextResponse.json({
        data: mergedData,
        isDelta: true
      });
    }

    // 3. Get Total Count (with basic caching to avoid repeated heavy queries)
    const countRes = await postQuery({
      fields: "COUNT(*) as total",
      tableName: (search && search.length > 2)
        ? "trhcalls tc (NOLOCK) LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode"
        : "trhcalls tc (NOLOCK)",
      condition
    });
    const totalCount = parseInt(countRes.data?.[0]?.total || "0");
    const totalPages = Math.ceil(totalCount / limit);

    // 4. Optimized Pagination Strategy (Flip-Sort for Deep Pages)
    // If the requested page is in the second half, we sort ASC and fetch from the bottom
    // to avoid massive 'top' values that crash the parser.
    const isDeepPage = page > totalPages / 2 && totalPages > 1;
    const fetchDirection = isDeepPage ? "ASC" : "DESC";
    
    // For deep pages, we calculate the offset from the end
    // Page 10 of 10 (DESC) = Page 1 of 10 (ASC)
    const effectivePage = isDeepPage ? (totalPages - page + 1) : page;
    const topValue = Math.min(effectivePage * limit, 10000); // Hard cap at 10k records to prevent OOM
    
    if (effectivePage * limit > 10000) {
      return NextResponse.json({ 
        error: "Deep pagination limit reached. Please use date filters to narrow your search.",
        data: [], 
        total: totalCount 
      }, { status: 400 });
    }

    const crmRes = await postQuery({
      fields: `tc.ncode, tc.vtrnno, tc.vtransfercallno, tc.nofficeid, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.approvedon, 126) as approvedon, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, p.vname as customer_name, o.vcompanyname as branch_name, tc.vcomplaint, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.vsolveremarks, tc.vpersoncalling, cr.vname as ncancelreason, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, tc.vserialno, tc.vlocation, tc.vcclid, tc.vmanualjobno, u.vname as engineer_name, tc.npriority, tc.bapproval, CONVERT(varchar(30), tc.editedon, 126) as editedon, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime, (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) as is_major_repair, (SELECT TOP 1 r.vname FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) as repair_category, (SELECT COUNT(*) FROM trdcalls3parts tp (NOLOCK) WHERE tp.ncalls = tc.ncode AND tp.nofficeid = tc.nofficeid) as part_count`,
      tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
      condition,
      orderBy: `tc.ncode ${fetchDirection}`,
      top: String(topValue)
    });

    if (!crmRes.data) return NextResponse.json({ data: [], total: totalCount });

    let paginatedCalls = crmRes.data.slice(-limit);
    
    // If we flipped the sort to ASC, the records in the slice are in ASC order
    // but the UI expects DESC (newest first).
    if (isDeepPage) {
      paginatedCalls.reverse();
    }

    // 5. Merge with Supabase Flags/Comments
    const callIds = paginatedCalls.map((c: any) => String(c.ncode));

    const [flagsRes, commentsRes] = await Promise.all([
      supabaseAdmin.from('call_flags').select('*').in('call_id', callIds),
      supabaseAdmin.from('call_comments').select('*').in('call_id', callIds).order('created_at', { ascending: false })
    ]);

    const flags = flagsRes.data || [];
    const comments = commentsRes.data || [];

    const mergedData = paginatedCalls.map((c: any) => {
      const id = String(c.ncode);
      const callFlag = flags.find(f => f.call_id === id);
      const callComments = comments.filter(cm => cm.call_id === id).map(cm => ({
        author_name: cm.author_name,
        comment: cm.comment || cm.content,
        created_at: cm.created_at
      }));

      let statusLabel = 'Open Unallocated';
      if (c.ncancelreason && String(c.ncancelreason) === '2') statusLabel = 'Transferred';
      else if (c.ncancelreason && c.ncancelreason !== '' && c.ncancelreason !== '0') statusLabel = 'Cancelled Call';
      else if (c.bsolved === 'True' || c.bsolved === 1 || c.bsolved === true) {
        const isRejected = String(c.bBMreject).toLowerCase() === 'true' || String(c.bBMreject) === '1' || c.bBMreject === true || c.bBMreject === 1;
        statusLabel = isRejected ? 'Closed - Rejected' : 'Closed';
      }
      else if (c.bfastclose === 'True' || c.bfastclose === 1 || c.bfastclose === true) statusLabel = 'Tech. Solve Call';
      else if (c.baccepted === 'True' || c.baccepted === 1 || c.baccepted === true) statusLabel = 'Allocated - Accepted';
      else if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') statusLabel = 'Assigned - Acceptance Pending';

      return {
        ...c,
        id,
        status_label: statusLabel,
        office_id: String(c.nofficeid),
        audit_flag: callFlag?.flag_type || null,
        comments: callComments,
        visit_count: 0, 
        part_count: Number(c.part_count) || 0,
        logged_at: c.dtrndate,
        started_at: c.dallocationdatetime || null,
        resolved_at: c.dfastclosedatetime || c.dsolvedatetime || null,
        approved_at: (String(c.bapproval).toLowerCase() === 'true' || String(c.bapproval) === '1' || c.bapproval === true || c.bapproval === 1) ? (c.editedon || c.approvedon) : null,
        rejected_at: (String(c.bBMreject).toLowerCase() === 'true' || String(c.bBMreject) === '1' || c.bBMreject === true || c.bBMreject === 1) ? c.dBMrejectdatetime : null,
        reject_reason: c.vBMrejectreason || null,
        solve_remarks: c.vsolveremarks || null,
        cancel_reason: c.ncancelreason || null
      };
    });

    return NextResponse.json({
      data: mergedData,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      isLive: true
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
