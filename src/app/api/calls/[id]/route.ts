import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { createClient } from '@/lib/supabase/server';

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
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');
  const vtrnno = searchParams.get('vtrnno');

  try {
    let parentCondition = '';
    const isNumericId = /^\\d+$/.test(id);
    
    if (vtrnno && vtrnno.trim() !== '') {
      parentCondition = `(tc.vtrnno = '${vtrnno.replace(/'/g, "''")}' OR tc.vtransfercallno = '${vtrnno.replace(/'/g, "''")}')`;
    } else if (!isNumericId) {
      parentCondition = `(tc.vtrnno = '${id.replace(/'/g, "''")}' OR tc.vtransfercallno = '${id.replace(/'/g, "''")}')`;
    } else {
      parentCondition = `tc.ncode = '${id.replace(/'/g, "''")}'`;
    }

    if (officeId && officeId.trim() !== '') {
      parentCondition = `(${parentCondition}) AND tc.nofficeid = '${officeId.replace(/'/g, "''")}'`;
    }

    // 1. Fetch parent call first by resolved key/office to avoid duplicates
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

    const realId = parentData.ncode;
    const realOfficeId = parentData.nofficeid || officeId;
    const realVtrnno = parentData.vtrnno || '';

    // 1.5 Fetch full history first to get all ncodes for optimal index seeks on child tables
    const historyRes = await postQuery({
      fields: "tc.ncode, tc.vtrnno, tc.vtransfercallno, tc.nofficeid, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, u.vname as engineer_name, o.vcompanyname as branch_name, tc.addedby, CONVERT(varchar(30), tc.addedon, 126) as addedon, CONVERT(varchar(30), tc.editedon, 126) as editedon, tc.vcomment, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime, cr.vname as cancel_reason_label",
      tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
      condition: realVtrnno ? `tc.vtrnno = '${realVtrnno}' OR tc.vtransfercallno = '${realVtrnno}' OR tc.ncode = '${realId}'` : `tc.ncode = '${realId}'`,
      orderBy: "ISNULL(tc.editedon, tc.addedon) ASC, tc.ncode ASC"
    });

    const historyData = historyRes.data || [];
    const allNcodes = Array.from(new Set(historyData.map((h: any) => h.ncode).filter(Boolean)));
    const ncodesStr = allNcodes.length > 0 ? allNcodes.join(',') : `'${realId}'`;

    const childCondition = `ncalls IN (${ncodesStr}) AND nofficeid = '${realOfficeId}'`;
    const childConditionV = `v.ncalls IN (${ncodesStr}) AND v.nofficeid = '${realOfficeId}'`;
    const childConditionF = `f.ncalls IN (${ncodesStr}) AND f.nofficeid = '${realOfficeId}'`;
    const childConditionP = `p.ncalls IN (${ncodesStr}) AND p.nofficeid = '${realOfficeId}'`;

    // 2. Fetch everything else in parallel using literal resolved keys
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

    // 3. Smart-Merge Serial Numbers into Parts
    const parts = rawParts.map((p: any) => {
      // Find matching serial entry (by part_id OR item_code)
      const serialEntry = serials.find((s: any) => 
        String(s.ncalls3) === String(p.part_id) || 
        (String(s.nitem) === String(p.nitem))
      );

      let vnewbarcode = p.vnewbarcode || '';
      let voldbarcode = p.voldbarcode || '';

      if (serialEntry) {
        vnewbarcode = serialEntry.vnewserialno || serialEntry.vserialno || vnewbarcode;
        voldbarcode = serialEntry.voldserialno || voldbarcode;
      }

      // Final fallback: Smart Extraction from visits
      if (!vnewbarcode || String(vnewbarcode).trim() === '') {
        const partNameLower = (p.vpartname || '').toLowerCase();
        const partCode = (p.vpartcode || '').toLowerCase();
        
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

      return { ...p, vnewbarcode, voldbarcode };
    });

    const bestRemark = parentData.vsolveremarks || (visits.length > 0 ? visits[0].vvisitremark : null);

    return NextResponse.json({
      visits: visits.map((v: any) => ({
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
      faults: faults.map((f: any) => ({
        visit_id: f.visit_id,
        complaint: f.complaint,
        defect: f.defect,
        repair: f.repair,
        is_solved: isCrmFlag(f.is_solved)
      })),
      parts: parts.map((p: any) => ({
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
      documents: docs.map((d: any) => ({
        filename: d.vnewfilename,
        original_name: d.vorigionalfilename,
        remarks: d.vremarks,
        office_id: d.nofficeid,
        uploaded_at: d.addedon
      })),
      history: (historyRes.data || []).map((h: any) => ({
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

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
