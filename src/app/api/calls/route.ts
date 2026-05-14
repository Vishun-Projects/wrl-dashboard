import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');
  const priority = searchParams.get('priority');
  const statusFilter = searchParams.get('status');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const search = searchParams.get('search');

  // Authentication
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Get User Profile for filtering
    const { data: profile } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', user.id)
      .single();

    const isHod = profile?.role === 'hod' || profile?.role === 'super_admin';
    const assignedOffices = profile?.office_ids || [];
    const visibleStatuses = profile?.visible_statuses || [];

    // 2. Build CRM Condition
    let condition = "(tc.ncancelreason IS NULL OR tc.ncancelreason = 0)"; // Properly exclude cancelled calls

    if (search && search.length > 2) {
      // Global search: be aggressive, ignore formatting like dashes
      condition += ` AND (REPLACE(tc.vtrnno, '-', '') LIKE '%${search}%' OR tc.vtrnno LIKE '%${search}%' OR tc.vtransfercallno LIKE '%${search}%')`;
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
        condition += ` AND tc.dtrndate >= '${startDate}' AND tc.dtrndate <= '${endDate} 23:59:59'`;
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
          if (statusFilter === 'Open Unallocated') condition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL) AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
          else if (statusFilter === 'Assigned') condition += " AND tc.nengineer > 0 AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
          else if (statusFilter === 'Tech. Solve Call') condition += " AND tc.bfastclose = 1 AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
          else if (statusFilter === 'Closed') condition += " AND tc.bsolved = 1";
        } else {
          // 'All' requested - combine all allowed statuses
          const statusConditions = (visibleStatuses as string[]).map((s: string) => {
            if (s === 'Open Unallocated') return "((tc.nengineer = 0 OR tc.nengineer IS NULL) AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL))";
            if (s === 'Assigned') return "(tc.nengineer > 0 AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL))";
            if (s === 'Tech. Solve Call') return "(tc.bfastclose = 1 AND (tc.bsolved = 0 OR tc.bsolved IS NULL))";
            if (s === 'Closed') return "(tc.bsolved = 1)";
            return "1=0";
          });
          condition += ` AND (${statusConditions.join(' OR ')})`;
        }
      } else if (statusFilter && statusFilter !== 'All') {
        // Standard HOD/Global filter
        if (statusFilter === 'Open Unallocated') condition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL) AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
        if (statusFilter === 'Assigned') condition += " AND tc.nengineer > 0 AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
        if (statusFilter === 'Tech. Solve Call') condition += " AND tc.bfastclose = 1 AND (tc.bsolved = 0 OR tc.bsolved IS NULL)";
        if (statusFilter === 'Closed') condition += " AND tc.bsolved = 1";
      }
    }



    // 3. Get Total Count (with basic caching to avoid repeated heavy queries)
    const countRes = await postQuery({
      fields: "COUNT(*) as total",
      tableName: "trhcalls tc (NOLOCK)",
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
      orderBy: `tc.dtrndate ${fetchDirection}`,
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
      if (c.ncancelreason && c.ncancelreason !== '') statusLabel = 'Cancelled Call';
      else if (c.bsolved === 'True' || c.bsolved === 1 || c.bsolved === true) statusLabel = 'Closed';
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
