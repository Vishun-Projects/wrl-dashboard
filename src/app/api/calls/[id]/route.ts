import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { supabase } from '@/lib/supabase';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('officeId');

  // Authentication
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.split(' ')[1];
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // 1. Fetch Visits and Parts directly from CRM
    const vtrnno = searchParams.get('vtrnno');

    // 1. Fetch everything in parallel
    const [visitsRes, faultsRes, partsRes, serialsRes, parentRes, docsRes] = await Promise.all([
      postQuery({ 
        fields: "v.vVisitTrnNo as vtrnno, v.vpersoncontected, CONVERT(varchar(30), v.dvisitdatetime, 126) as dvisitdatetime, v.vvisitremark, v.vcustomerRemarks, v.vPartsReplacedDetails, v.ntimespent, v.nvisitexpense, v.nofficeid, v.vcustomersignPath, v.vengineersignPath", 
        tableName: "trdcalls1visit v (NOLOCK)", 
        condition: `v.ncalls = '${id}' AND v.nofficeid = '${officeId}'` 
      }),
      postQuery({
        fields: "f.ncalls1 as visit_id, c.vname as complaint, d.vname as defect, r.vname as repair, f.bsolve as is_solved",
        tableName: "trdcalls2fault f (NOLOCK) LEFT JOIN mstcomplaint c (NOLOCK) ON f.ncomplaint = c.ncode LEFT JOIN mstdefect d (NOLOCK) ON f.ndefect = d.ncode LEFT JOIN mstrepair r (NOLOCK) ON f.nrepair = r.ncode",
        condition: `f.ncalls = '${id}' AND f.nofficeid = '${officeId}'`
      }),
      postQuery({ 
        fields: "p.ncode as part_id, i.vname as vpartname, i.vitemcode as vpartcode, p.nitem, p.nquantity as nqty, p.nofficeid, p.nrate, p.ndiscountamt, p.ntaxamt, p.bclaimed, p.vremarks as vpartremarks, p.vnewbarcode, p.voldbarcode", 
        tableName: "trdcalls3parts p (NOLOCK) LEFT JOIN mstitems i (NOLOCK) ON p.nitem = i.ncode", 
        condition: `p.ncalls = '${id}' AND p.nofficeid = '${officeId}'` 
      }),
      postQuery({
        fields: "ncalls3, nitem, vnewserialno, voldserialno, vserialno, vOld_vnewserialno",
        tableName: "trdcalls3parts1serialno (NOLOCK)",
        condition: `ncalls = '${id}' AND nofficeid = '${officeId}'`
      }),
      postQuery({
        fields: "tc.vtrnno, tc.vtransfercallno, tc.vserialno, tc.vmanualjobno, tc.vlocation, tc.vpersoncalling, tc.vcomplaint, tc.vsolveremarks, tc.ncancelreason, cr.vname as ncancelreason_label, tc.callStatus, tc.bsolved, tc.bfastclose, tc.baccepted, tc.nengineer, u.vname as engineer_name, p.vname as customer_name, o.vcompanyname as branch_name, CONVERT(varchar(30), tc.dtrndate, 126) as dtrndate, CONVERT(varchar(30), tc.dallocationdatetime, 126) as dallocationdatetime, CONVERT(varchar(30), tc.dsolvedatetime, 126) as dsolvedatetime, CONVERT(varchar(30), tc.dfastclosedatetime, 126) as dfastclosedatetime, tc.bBMreject, tc.vBMrejectreason, CONVERT(varchar(30), tc.dBMrejectdatetime, 126) as dBMrejectdatetime",
        tableName: "trhcalls tc (NOLOCK) LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode",
        condition: `tc.ncode = '${id}' AND tc.nofficeid = '${officeId}'`
      }),
      postQuery({
        fields: "vnewfilename, vorigionalfilename, vremarks, nofficeid, CONVERT(varchar(30), addedon, 126) as addedon",
        tableName: "trhdoc (NOLOCK)",
        condition: `ncalls = '${id}' AND nofficeid = '${officeId}'`
      })
    ]);

    const visits = visitsRes.data || [];
    const faults = faultsRes.data || [];
    const rawParts = partsRes.data || [];
    const serials = serialsRes.data || [];
    const parentData = parentRes.data?.[0] || {};
    const docs = docsRes.data || [];



    // 2. Smart-Merge Serial Numbers into Parts
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
        is_solved: f.is_solved === 'True' || f.is_solved === true || f.is_solved === 1
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
      vtrnno: parentData.vtrnno,
      vtransfercallno: parentData.vtransfercallno,
      solve_remarks: bestRemark,
      cancel_reason: parentData.ncancelreason,
      resolved_at: parentData.dfastclosedatetime,
      complaint_label: parentData.vcomplaint,
      crm_reject: parentData.bBMreject === 'True' || parentData.bBMreject === true || parentData.bBMreject === 1,
      crm_reject_reason: parentData.vBMrejectreason,
      crm_reject_at: parentData.dBMrejectdatetime,
      documents: docs.map((d: any) => ({
        filename: d.vnewfilename,
        original_name: d.vorigionalfilename,
        remarks: d.vremarks,
        office_id: d.nofficeid,
        uploaded_at: d.addedon
      }))
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
