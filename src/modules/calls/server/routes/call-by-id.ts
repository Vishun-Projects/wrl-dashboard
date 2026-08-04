import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { canAccessOffice } from '@/sql/trhcalls/office-security';
import { safeErrorMessage } from '@/lib/api/safe-error';

function isCrmFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const security = await resolveReportSecurity(user.id, {
    pageId: 'mis_reports',
    tabId: 'register',
  });
  if (security.forbidden) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');
  const vtrnno = searchParams.get('vtrnno');

  try {
    let parentCondition = '';
    const isNumericId = /^\d+$/.test(id);
    const safeId = id.replace(/'/g, "''");
    const safeTrn = (vtrnno ?? '').trim().replace(/'/g, "''");

    // Prefer exact ncode when the client passed one — TRN alone can resolve the wrong leg.
    if (isNumericId) {
      parentCondition = `tc.ncode = '${safeId}'`;
    } else if (safeTrn) {
      parentCondition = `(tc.vtrnno = '${safeTrn}' OR tc.vtransfercallno = '${safeTrn}')`;
    } else {
      parentCondition = `(tc.vtrnno = '${safeId}' OR tc.vtransfercallno = '${safeId}')`;
    }

    if (officeId && officeId.trim() !== '') {
      parentCondition = `(${parentCondition}) AND tc.nofficeid = '${officeId.replace(/'/g, "''")}'`;
    }

    const parentRes = await postQuery({
      fields: "tc.ncode, tc.nofficeid, tc.vtrnno, tc.vtransfercallno, tc.vserialno, tc.vmanualjobno, tc.vlocation, tc.vpersoncalling, tc.vcomplaint, tc.vsolveremarks, tc.ncancelreason, cr.vname as ncancelreason_label, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, u.vname as engineer_name, p.vname as customer_name, o.vcompanyname as branch_name, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime",
      tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
      condition: parentCondition,
      orderBy: "ISNULL(tc.editedon, tc.addedon) DESC, tc.ncode DESC"
    });

    const parentData = parentRes.data?.[0];
    if (!parentData) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    if (!canAccessOffice(security.isHod, security.assignedOffices, parentData.nofficeid)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const realId = String(parentData.ncode).replace(/'/g, "''");
    const realOfficeId = String(parentData.nofficeid || officeId || '').replace(/'/g, "''");
    const realVtrnno = String(parentData.vtrnno || '').replace(/'/g, "''");

    // History tab: transfer-chain rows for this TRN (office-scoped). Do NOT use these
    // ncodes for visits/faults/parts — that pulled older sibling calls' child rows.
    let historyCondition = `tc.ncode = '${realId}'`;
    if (realVtrnno) {
      historyCondition = `(tc.vtrnno = '${realVtrnno}' OR tc.vtransfercallno = '${realVtrnno}' OR tc.ncode = '${realId}')`;
    }
    if (realOfficeId) {
      historyCondition = `(${historyCondition}) AND tc.nofficeid = '${realOfficeId}'`;
    }

    const historyRes = await postQuery({
      fields: "tc.ncode, tc.vtrnno, tc.vtransfercallno, tc.nofficeid, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, u.vname as engineer_name, o.vcompanyname as branch_name, tc.addedby, CONVERT(varchar(30), tc.addedon, 126) as addedon, CONVERT(varchar(30), tc.editedon, 126) as editedon, tc.vcomment, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime, cr.vname as cancel_reason_label",
      tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
      condition: historyCondition,
      orderBy: "ISNULL(tc.editedon, tc.addedon) ASC, tc.ncode ASC"
    });

    // Child tables: this call only (ncode + office).
    const childCondition = `ncalls = '${realId}' AND nofficeid = '${realOfficeId}'`;
    const childConditionV = `v.ncalls = '${realId}' AND v.nofficeid = '${realOfficeId}'`;
    const childConditionF = `f.ncalls = '${realId}' AND f.nofficeid = '${realOfficeId}'`;
    const childConditionP = `p.ncalls = '${realId}' AND p.nofficeid = '${realOfficeId}'`;

    const [visitsRes, faultsRes, partsRes, serialsRes, docsRes] = await Promise.all([
      postQuery({ 
        fields: "v.vVisitTrnNo as vtrnno, v.vpersoncontected, CONVERT(varchar(30), v.dvisitdatetime, 126) as dvisitdatetime, v.vvisitremark, v.vcustomerRemarks, v.vPartsReplacedDetails, v.ntimespent, v.nvisitexpense, v.nofficeid, v.vcustomersignPath, v.vengineersignPath", 
        tableName: "trdcalls1visit v (NOLOCK)", 
        condition: childConditionV 
      }),
      postQuery({
        fields: "f.ncalls1 as visit_id, c.vname as complaint, d.vname as defect, r.vname as repair, f.bsolve as is_solved",
        tableName: "trdcalls2fault f (NOLOCK) LEFT JOIN mstcomplaint c (NOLOCK) ON f.ncomplaint = c.ncode LEFT JOIN mstdefect d (NOLOCK) ON f.ndefect = d.ncode LEFT JOIN mstrepair r (NOLOCK) ON f.nrepair = r.ncode",
        condition: childConditionF
      }),
      postQuery({ 
        fields: "p.ncode as part_id, i.vname as vpartname, i.vitemcode as vpartcode, p.nitem, p.nquantity as nqty, p.nofficeid, p.nrate, p.ndiscountamt, p.ntaxamt, p.bclaimed, p.vremarks as vpartremarks, p.vnewbarcode, p.voldbarcode", 
        tableName: "trdcalls3parts p (NOLOCK) LEFT JOIN mstitems i (NOLOCK) ON p.nitem = i.ncode", 
        condition: childConditionP 
      }),
      postQuery({
        fields: "ncalls3, nitem, vnewserialno, voldserialno, vserialno, vOld_vnewserialno",
        tableName: "trdcalls3parts1serialno (NOLOCK)",
        condition: childCondition
      }),
      postQuery({
        fields: "vnewfilename, vorigionalfilename, vremarks, nofficeid, CONVERT(varchar(30), addedon, 126) as addedon",
        tableName: "trhdoc (NOLOCK)",
        condition: childCondition
      })
    ]);

    const visits = visitsRes.data || [];
    const faults = faultsRes.data || [];
    const rawParts = partsRes.data || [];
    const serials = serialsRes.data || [];
    const docs = docsRes.data || [];

        const parts = rawParts.map((part: Record<string, string>): Record<string, string> => {
      const serialEntry = serials.find((serial: Record<string, string>) => 
        String(serial.ncalls3) === String(part.part_id) || 
        (String(serial.nitem) === String(part.nitem))
      );

      let vnewbarcode = part.vnewbarcode || '';
      let voldbarcode = part.voldbarcode || '';

      if (serialEntry) {
        vnewbarcode = serialEntry.vnewserialno || serialEntry.vserialno || vnewbarcode;
        voldbarcode = serialEntry.voldserialno || voldbarcode;
      }

      // Barcodes often empty in CRM; last-resort parse from visit remarks.
      if (!vnewbarcode || String(vnewbarcode).trim() === '') {
        const partNameLower = (part.vpartname || '').toLowerCase();
        const partCode = (part.vpartcode || '').toLowerCase();
        
        for (const v of visits) {
          const remarkText = `${v.vvisitremark || ''} ${v.vPartsReplacedDetails || ''} ${v.vcustomerRemarks || ''}`;
          const remarkLower = remarkText.toLowerCase();
          
          if (remarkLower.includes(partCode) || 
              (partNameLower.includes('motor') && remarkLower.includes('motor')) ||
              (partNameLower.includes('compressor') && remarkLower.includes('compressor'))) {
            
            const serialRegex = /(?:new|sl|serial|barcode|srno|sno|s\.no|sr\.no|no|:)\s*(?:number|no|:)?\s*[:\s\[]*([A-Z0-9-]{10,30})/i;
            const match = remarkText.match(serialRegex);
            if (match) {
              vnewbarcode = match[1];
              break;
            }
          }
        }
      }

      return { ...part, vnewbarcode, voldbarcode };
    });

    const bestRemark = parentData.vsolveremarks || (visits.length > 0 ? visits[0].vvisitremark : null);

    return NextResponse.json({
      visits: visits.map((v) => ({
        vtrnno: v.vtrnno,
        dvisitdatetime: v.dvisitdatetime,
        vvisitremark: v.vvisitremark,
        vcustomerRemarks: v.vcustomerRemarks,
        vPartsReplacedDetails: v.vPartsReplacedDetails,
        ntimespent: v.ntimespent,
        nvisitexpense: v.nvisitexpense,
        vpersoncontected: v.vpersoncontected,
        office_id: String(v.nofficeid),
        customer_sign: v.vcustomersignPath,
        engineer_sign: v.vengineersignPath
      })),
      faults: faults.map((f) => ({
        visit_id: f.visit_id,
        complaint: f.complaint,
        defect: f.defect,
        repair: f.repair,
        is_solved: isCrmFlag(f.is_solved)
      })),
      parts: parts.map((p) => ({
        vpartname: p.vpartname,
        vpartcode: p.vpartcode,
        nqty: p.nqty,
        nrate: p.nrate,
        ndiscount: p.ndiscountamt,
        ntax: p.ntaxamt,
        bclaimed: p.bclaimed,
        vremarks: p.vpartremarks,
        vnewbarcode: p.vnewbarcode,
        voldbarcode: p.voldbarcode,
        office_id: String(p.nofficeid)
      })),
      ncode: parentData.ncode,
      nofficeid: parentData.nofficeid,
      vtrnno: parentData.vtrnno,
      vtransfercallno: parentData.vtransfercallno,
      vserialno: parentData.vserialno,
      vmanualjobno: parentData.vmanualjobno,
      engineer_name: parentData.engineer_name,
      branch_name: parentData.branch_name,
      customer_name: parentData.customer_name,
      vlocation: parentData.vlocation,
      vpersoncalling: parentData.vpersoncalling,
      logged_at: parentData.dtrndate,
      started_at: parentData.dallocationdatetime,
      solve_remarks: bestRemark,
      cancel_reason: parentData.ncancelreason,
      resolved_at: parentData.dfastclosedatetime || parentData.dsolvedatetime || null,
      complaint_label: parentData.vcomplaint,
      crm_reject: isCrmFlag(parentData.bBMreject),
      crm_reject_reason: parentData.vBMrejectreason,
      crm_reject_at: parentData.dBMrejectdatetime,
      documents: docs.map((d) => ({
        filename: d.vnewfilename,
        original_name: d.vorigionalfilename,
        remarks: d.vremarks,
        office_id: d.nofficeid,
        uploaded_at: d.addedon
      })),
      history: (historyRes.data || []).map((h) => ({
        ncode: h.ncode,
        vtrnno: h.vtrnno,
        vtransfercallno: h.vtransfercallno,
        office_id: String(h.nofficeid),
        dtrndate: h.dtrndate,
        dallocationdatetime: h.dallocationdatetime,
        dsolvedatetime: h.dsolvedatetime,
        dfastclosedatetime: h.dfastclosedatetime,
        callStatus: h.callStatus,
        bsolved: isCrmFlag(h.bsolved),
        bfastclose: isCrmFlag(h.bfastclose),
        baccepted: isCrmFlag(h.baccepted),
        nengineer: h.nengineer,
        engineer_name: h.engineer_name,
        branch_name: h.branch_name,
        addedby: h.addedby,
        addedon: h.addedon,
        editedon: h.editedon,
        vcomment: h.vcomment,
        bBMreject: isCrmFlag(h.bBMreject),
        vBMrejectreason: h.vBMrejectreason,
        dBMrejectdatetime: h.dBMrejectdatetime,
        cancel_reason_label: h.cancel_reason_label
      }))
    });

  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load call details') },
      { status: 500 }
    );
  }
}
