import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';
import pincodeMapData from '../../report/distribution/pincode_map.json';

const cityToStateMap: Record<string, string> = {
  'MUMBAI': 'MAHARASHTRA',
  'PUNE': 'MAHARASHTRA',
  'AHMEDABAD': 'GUJARAT',
  'SURAT': 'GUJARAT',
  'VADODARA': 'GUJARAT',
  'RAJKOT': 'GUJARAT',
  'JAIPUR': 'RAJASTHAN',
  'BENGALURU': 'KARNATAKA',
  'BANGALORE': 'KARNATAKA',
  'CHENNAI': 'TAMIL NADU',
  'HYDERABAD': 'TELANGANA',
  'KOLKATA': 'WEST BENGAL',
  'INDORE': 'MADHYA PRADESH',
  'NAGPUR': 'MAHARASHTRA',
  'NASHIK': 'MAHARASHTRA',
  'AURANGABAD': 'MAHARASHTRA',
  'KOLHAPUR': 'MAHARASHTRA',
  'SOLAPUR': 'MAHARASHTRA',
  'THANE': 'MAHARASHTRA',
  'NAVIMUMBAI': 'MAHARASHTRA',
  'NAVI MUMBAI': 'MAHARASHTRA',
  'BHANDARA': 'MAHARASHTRA'
};

const VALID_INDIAN_STATES = new Set([
  'ANDHRA PRADESH', 'ARUNACHAL PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT', 'HARYANA', 
  'HIMACHAL PRADESH', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA PRADESH', 'MAHARASHTRA', 'MANIPUR', 
  'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL NADU', 'TELANGANA', 
  'TRIPURA', 'UTTAR PRADESH', 'UTTARAKHAND', 'WEST BENGAL', 'ANDAMAN AND NICOBAR ISLANDS', 'CHANDIGARH', 
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU', 'LAKSHADWEEP', 'DELHI', 'PUDUCHERRY', 'JAMMU & KASHMIR', 
  'JAMMU AND KASHMIR', 'LADAKH'
]);

const STATE_NAME_CORRECTIONS: Record<string, string> = {
  'TAMILNADU': 'TAMIL NADU',
  'WESTBENGAL': 'WEST BENGAL',
  'MADHYAPRADESH': 'MADHYA PRADESH',
  'ANDHRAPRADESH': 'ANDHRA PRADESH',
  'UTTARPRADESH': 'UTTAR PRADESH',
  'UTTARAKHAND': 'UTTARAKHAND',
  'CHATTISGARH': 'CHHATTISGARH',
  'ODISHA': 'ODISHA',
  'ORISSA': 'ODISHA',
  'DELHI': 'DELHI',
  'NEW DELHI': 'DELHI',
  'PONDICHERRY': 'PUDUCHERRY',
  'PUDUCHERRY': 'PUDUCHERRY',
  'JAMMU': 'JAMMU & KASHMIR',
  'KASHMIR': 'JAMMU & KASHMIR',
  'JAMMU AND KASHMIR': 'JAMMU & KASHMIR',
  'JAMMU & KASHMIR': 'JAMMU & KASHMIR',
  'DADRA & NAGAR HAVELI': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'DAMAN & DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'DAMAN AND DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU'
};

function isValidState(s: string): boolean {
  if (!s) return false;
  const normalized = s.toUpperCase().trim();
  if (normalized === 'NA' || normalized === 'N/A' || normalized === 'UNKNOWN' || normalized === 'Z CITY' || normalized === 'Z-CITY' || normalized === '') return false;
  
  let corrected = normalized;
  if (STATE_NAME_CORRECTIONS[normalized]) {
    corrected = STATE_NAME_CORRECTIONS[normalized];
  } else {
    const spaceLess = normalized.replace(/\s+/g, '');
    if (STATE_NAME_CORRECTIONS[spaceLess]) {
      corrected = STATE_NAME_CORRECTIONS[spaceLess];
    }
  }

  return VALID_INDIAN_STATES.has(corrected);
}

function isValidCity(c: string): boolean {
  if (!c) return false;
  const normalized = c.toUpperCase().trim();
  if (normalized === 'NA' || normalized === 'N/A' || normalized === 'UNKNOWN' || normalized === 'Z CITY' || normalized === 'Z-CITY' || normalized === 'TEST' || normalized === 'DUMMY' || normalized === '') return false;
  if (normalized.startsWith('Z ') || normalized.startsWith('Z-') || normalized === 'Z' || normalized.includes('Z_')) return false;
  return true;
}

function getGeographicDetails(pincode: string, dbCity?: string, dbState?: string) {
  const pin = String(pincode || '').trim();
  
  let state = '';
  let city = '';

  // Lookup in our pincode map
  const mapped = (pincodeMapData as Record<string, any>)[pin];
  
  let mappedState = mapped?.s || '';
  let mappedCity = mapped?.d || '';

  if (mappedState) {
    const upState = mappedState.toUpperCase().trim();
    if (STATE_NAME_CORRECTIONS[upState]) {
      mappedState = STATE_NAME_CORRECTIONS[upState];
    } else {
      const spaceLess = upState.replace(/\s+/g, '');
      if (STATE_NAME_CORRECTIONS[spaceLess]) {
        mappedState = STATE_NAME_CORRECTIONS[spaceLess];
      }
    }
  }

  const dbStateUpper = (dbState || '').toUpperCase().trim();
  let resolvedDbState = dbStateUpper;
  if (STATE_NAME_CORRECTIONS[dbStateUpper]) {
    resolvedDbState = STATE_NAME_CORRECTIONS[dbStateUpper];
  } else {
    const spaceLess = dbStateUpper.replace(/\s+/g, '');
    if (STATE_NAME_CORRECTIONS[spaceLess]) {
      resolvedDbState = STATE_NAME_CORRECTIONS[spaceLess];
    }
  }
  const resolvedDbCity = (dbCity || '').toUpperCase().trim();

  // Prioritize valid database values first!
  if (isValidState(resolvedDbState) && isValidCity(resolvedDbCity)) {
    state = resolvedDbState;
    city = resolvedDbCity;
  } else if (isValidState(mappedState) && isValidCity(mappedCity)) {
    state = mappedState;
    city = mappedCity;
  } else {
    if (isValidState(resolvedDbState)) {
      state = resolvedDbState;
    } else if (isValidState(mappedState)) {
      state = mappedState;
    }

    if (isValidCity(resolvedDbCity)) {
      city = resolvedDbCity;
    } else if (isValidCity(mappedCity)) {
      city = mappedCity;
    }
  }

  if (!isValidState(state)) state = 'UNKNOWN';
  if (!isValidCity(city)) city = 'UNKNOWN';

  state = state.toUpperCase().trim();
  city = city.toUpperCase().trim();

  if (cityToStateMap[city]) {
    state = cityToStateMap[city];
  }

  return { state, city };
}

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
    const pincode = searchParams.get('pincode') || '';
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

    // Base condition is on raw table alias 'tc'
    // Include transferred calls even when vtrnno is empty by treating transfer call no or cancel reason 2 as valid records.
    let condition = "((tc.vtrnno IS NOT NULL AND tc.vtrnno <> '') OR (tc.ncancelreason = 2 OR (tc.vtransfercallno IS NOT NULL AND tc.vtransfercallno <> '')))";

    if (search && search.trim().length > 0) {
      const searchSafe = search.replace(/'/g, "''");
      const exactTrn = getExactTrnQuery(searchSafe);
      if (exactTrn) {
        condition += ` AND (tc.vtrnno = '${exactTrn}')`;
      } else {
        // Global search: ignore all filters (dates, status, etc.) to look up the specific record historically
        condition += ` AND (tc.vtrnno LIKE '%${searchSafe}%' OR tc.vtransfercallno LIKE '%${searchSafe}%' OR p.vname LIKE '%${searchSafe}%' OR mstitems.vname LIKE '%${searchSafe}%' OR tc.vserialno LIKE '%${searchSafe}%' OR p.vinstpostalcode LIKE '%${searchSafe}%')`;
      }
    } else {
      if (officeId && officeId !== 'All') {
        if (officeId.includes(',')) {
          condition += ` AND tc.nofficeid IN (${officeId})`;
        } else {
          condition += ` AND tc.nofficeid = ${officeId}`;
        }
      } else if (!isHod && assignedOffices.length > 0) {
        condition += ` AND tc.nofficeid IN (${assignedOffices.join(',')})`;
      }

      if (startDate) {
        condition += ` AND tc.dtrndate >= '${startDate}'`;
      }
      if (endDate) {
        condition += ` AND tc.dtrndate <= '${endDate} 23:59:59'`;
      }

      if (account && account !== 'All') {
        const accountNameSafe = account.replace(/'/g, "''");
        condition += ` AND tc.npartyprofile IN (SELECT ncode FROM mstpartyprofile WHERE vname LIKE '%${accountNameSafe}%')`;
      }

      if (callType && callType !== 'All') {
        if (callType.includes(',')) {
          const types = callType.split(',').map(t => `'${t.trim().replace(/'/g, "''")}'`).join(',');
          condition += ` AND tc.ncalltype IN (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue IN (${types}))`;
        } else {
          condition += ` AND tc.ncalltype = (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue = '${callType.replace(/'/g, "''")}')`;
        }
      }

      if (region && region !== 'All') {
        const regionsArray = region.split(',').map(r => `'${r.replace(/'/g, "''")}'`).join(',');
        condition += ` AND tc.nofficeid IN (
          SELECT o.ncode FROM mstoffice o
          LEFT JOIN mstoffice op ON o.nunder = op.ncode AND o.nunder <> 0
          LEFT JOIN mstzones z ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
          WHERE z.vname IN (${regionsArray})
        )`;
      }

      if (status && status !== 'All') {
        if (status === 'Open Unallocated') {
          condition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Assigned') {
          condition += " AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Tech. Solve Call') {
          condition += " AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Closed') {
          condition += " AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed')";
        }
      }
      if (pincode) {
        const pincodeSafe = pincode.replace(/'/g, "''");
        condition += ` AND p.vinstpostalcode LIKE '%${pincodeSafe}%'`;
      }
    }

    if (lastSync) {
      condition += ` AND (
        tc.dtrndate >= '${lastSync}'
        OR tc.dsolvedatetime >= '${lastSync}'
      )`;
    }

    // Direct table join matching the Calls register exactly
    const fields = `
      tc.ntrnno as callsntrnno,
      CONVERT(varchar(30), tc.dtrndate, 126) as callsdtrndate,
      p.vname as PartyName,
      p.vinstpostalcode as Pincode,
      cty.vname as dbCity,
      st.vname as dbState,
      tc.ntransfertooffice as franchisee_code,
      tc.vlocation as vlocation,
      mstitems.vitemcode as itemcode,
      mstitems.vname as itemname,
      tc.vserialno as callsvserialno,
      u.vname as serviceman,
      tc.vcomplaint as vcomplaint,
      tc.callStatus as Status,
      case when tc.bsolved=1 then 'Solved' else case when tc.ncancelreason Is not null and tc.ncancelreason <> 0 then 'Cancel' else case when (tc.bsolved=0 or tc.bsolved is null) and (tc.ncancelreason IS null or tc.ncancelreason = 0) then 'Open' end end end as callstatus,
      tc.bsolved as callsolved,
      priority_fs.vdisplayvalue as Priority,
      CONVERT(varchar(30), tc.dsolvedatetime, 126) as callsolveddate,
      tc.vsolveremarks as vsolveremarks,
      tc.vtrnno as UniqueCallNo,
      tc.vpersoncalling as vpersoncalling,
      p.vinsttel1 as vinsttel1,
      p.vinstaddress as vinstaddress,
      tc.addedby as addedby,
      o.vcompanyname as officename,
      calltype_fs.vdisplayvalue as calltype,
      tc.vtransfercallno as vtransfercallno,
      transferoffice.vcompanyname as vtransferofficename,
      tc.bfastclose as bfastclose,
      tc.nengineer as nengineer,
      tc.nofficeid as nofficeid,
      case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 'Yes' else 'No' end as bmreject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 'Yes' else 'No' end as horeject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 2 else case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 1 end end as rejectionstatus,
      tc.vcomment as vcomment,
      tc.vBMrejectreason as vBMrejectreason,
      cr.vname as cancel_reason
    `;

    let subqueryCondition = "";
    if (startDate) {
      if (lastSync) {
        subqueryCondition = `WHERE dtrndate >= '${startDate}' OR dtrndate >= '${lastSync}' OR dsolvedatetime >= '${lastSync}'`;
      } else {
        subqueryCondition = `WHERE dtrndate >= '${startDate}'`;
      }
    } else if (lastSync) {
      subqueryCondition = `WHERE dtrndate >= '${lastSync}' OR dsolvedatetime >= '${lastSync}'`;
    }

    const LATEST_CALLS_SUBQUERY = `(
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
    ) tc`;


    const tableName = `
      ${LATEST_CALLS_SUBQUERY}
      LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
      LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
      LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
      LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
      LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
      LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
      LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
      LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
      LEFT JOIN mstfixedselection priority_fs (NOLOCK) ON tc.npriority = priority_fs.ncode AND priority_fs.vfieldname = 'npriority'
      LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
    `;

    if (lastSync) {
      const res = await postQuery({
        fields,
        tableName,
        condition,
        orderBy: "tc.ncode DESC" // Order by recently edited/added
      });

      const processedData = (res.data || []).map((row: any) => {
        const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
        return {
          ...row,
          state: geo.state,
          city: geo.city,
          franchisee_name: row.vtransferofficename || 'Unallocated',
          franchisee_code: row.franchisee_code ? String(row.franchisee_code) : 'UNASSIGNED',
          resolved_branch: row.officename || 'UNKNOWN',
          resolved_branch_code: row.nofficeid ? String(row.nofficeid) : 'UNKNOWN',
          technician_name: row.serviceman || 'UNKNOWN'
        };
      });

      return NextResponse.json({
        data: processedData,
        isDelta: true
      });
    }

    const topValue = page * limit;
    const [countRes, res, summaryRes] = await Promise.all([
      postQuery({
        fields: "COUNT(*) as total",
        tableName,
        condition
      }),
      postQuery({
        fields,
        tableName,
        condition,
        orderBy: "tc.ncode DESC",
        top: String(topValue)
      }),
      postQuery({
        fields: `
          COUNT(*) as total,
          SUM(CASE WHEN ISNULL(tc.vtransfercallno, '') <> '' OR tc.ncancelreason = 2 THEN 1 ELSE 0 END) as transferred,
          SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled,
          SUM(CASE WHEN tc.bsolved = 1 OR tc.bfastclose = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed' THEN 1 ELSE 0 END) as solved,
          SUM(CASE WHEN (tc.bsolved = 0 OR tc.bsolved IS NULL) AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls
        `,
        tableName,
        condition
      })
    ]);

    const totalCount = parseInt(countRes.data?.[0]?.total || "0");
    const summary = summaryRes.data?.[0] || { total: 0, transferred: 0, cancelled: 0, solved: 0, open_calls: 0 };

    const processedData = (res.data || []).map((row: any) => {
      const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
      return {
        ...row,
        state: geo.state,
        city: geo.city,
        franchisee_name: row.vtransferofficename || 'Unallocated',
        franchisee_code: row.franchisee_code ? String(row.franchisee_code) : 'UNASSIGNED',
        resolved_branch: row.officename || 'UNKNOWN',
        resolved_branch_code: row.nofficeid ? String(row.nofficeid) : 'UNKNOWN',
        technician_name: row.serviceman || 'UNKNOWN'
      };
    });

    return NextResponse.json({
      data: processedData,
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
