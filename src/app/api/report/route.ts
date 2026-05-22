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

function filterCallsCSR(calls: any[], criteria: any, exclude?: string) {
  return calls.filter((c) => {
    if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
      if (c.state !== criteria.state) return false;
    }
    if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
      if (c.city !== criteria.city) return false;
    }
    if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
      if (String(c.nofficeid) !== criteria.branch) return false;
    }
    if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
      if (c.franchisee_code !== criteria.franchisee) return false;
    }
    if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
      if (String(c.nengineer) !== criteria.technician) return false;
    }
    return true;
  });
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

    // Cascading filters
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';
    const branch = searchParams.get('branch') || '';
    const franchisee = searchParams.get('franchisee') || '';
    const technician = searchParams.get('technician') || '';

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
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    // Base condition is on raw table alias 'tc'
    // Include transferred calls even when vtrnno is empty by treating transfer call no or cancel reason 2 as valid records.
    let baseCondition = "((tc.vtrnno IS NOT NULL AND tc.vtrnno <> '') OR (tc.ncancelreason = 2 OR (tc.vtransfercallno IS NOT NULL AND tc.vtransfercallno <> '')))";

    if (search && search.trim().length > 0) {
      const searchSafe = search.replace(/'/g, "''");
      const exactTrn = getExactTrnQuery(searchSafe);
      if (exactTrn) {
        baseCondition += ` AND (tc.vtrnno = '${exactTrn}')`;
      } else {
        // Global search: ignore all filters (dates, status, etc.) to look up the specific record historically
        baseCondition += ` AND (tc.vtrnno LIKE '%${searchSafe}%' OR tc.vtransfercallno LIKE '%${searchSafe}%' OR p.vname LIKE '%${searchSafe}%' OR mstitems.vname LIKE '%${searchSafe}%' OR tc.vserialno LIKE '%${searchSafe}%' OR p.vinstpostalcode LIKE '%${searchSafe}%')`;
      }
    } else {
      let dbSecurityCondition = '';
      if (!isHod && assignedOffices.length > 0) {
        const allowed = assignedOffices.join(',');
        dbSecurityCondition = ` AND (tc.nofficeid IN (${allowed}) OR o.nunder IN (${allowed}))`;
      }

      if (officeId && officeId !== 'All' && officeId !== 'undefined' && officeId !== 'null') {
        if (officeId.includes(',')) {
          baseCondition += ` AND tc.nofficeid IN (${officeId})`;
        } else {
          baseCondition += ` AND tc.nofficeid = ${officeId}`;
        }
      }
      
      baseCondition += dbSecurityCondition;

      if (startDate) {
        baseCondition += ` AND tc.dtrndate >= '${startDate}'`;
      }
      if (endDate) {
        baseCondition += ` AND tc.dtrndate <= '${endDate} 23:59:59'`;
      }

      if (account && account !== 'All' && account !== 'undefined' && account !== 'null') {
        const accountNameSafe = account.replace(/'/g, "''");
        baseCondition += ` AND tc.npartyprofile IN (SELECT ncode FROM mstpartyprofile WHERE vname LIKE '%${accountNameSafe}%')`;
      }

      if (callType && callType !== 'All' && callType !== 'undefined' && callType !== 'null') {
        if (callType.includes(',')) {
          const types = callType.split(',').map(t => `'${t.trim().replace(/'/g, "''")}'`).join(',');
          baseCondition += ` AND tc.ncalltype IN (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue IN (${types}))`;
        } else {
          baseCondition += ` AND tc.ncalltype = (SELECT ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue = '${callType.replace(/'/g, "''")}')`;
        }
      }

      if (region && region !== 'All') {
        const regionsArray = region.split(',').map(r => `'${r.replace(/'/g, "''")}'`).join(',');
        baseCondition += ` AND tc.nofficeid IN (
          SELECT o.ncode FROM mstoffice o
          LEFT JOIN mstoffice op ON o.nunder = op.ncode AND o.nunder <> 0
          LEFT JOIN mstzones z ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
          WHERE z.vname IN (${regionsArray})
        )`;
      }

      if (status && status !== 'All') {
        if (status === 'Open Unallocated') {
          baseCondition += " AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Assigned') {
          baseCondition += " AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Tech. Solve Call') {
          baseCondition += " AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
        } else if (status === 'Closed') {
          baseCondition += " AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed')";
        }
      }
      if (pincode) {
        const pincodeSafe = pincode.replace(/'/g, "''");
        baseCondition += ` AND p.vinstpostalcode LIKE '%${pincodeSafe}%'`;
      }
    }

    if (lastSync) {
      baseCondition += ` AND (
        tc.dtrndate >= '${lastSync}'
        OR tc.dsolvedatetime >= '${lastSync}'
      )`;
    }

    let condition = baseCondition;

    // Helper functions to find pincodes mapped in JSON
    const getPincodesForState = (stateName: string): string[] => {
      const normalizedState = stateName.toUpperCase().trim();
      const pins: string[] = [];
      for (const [pin, val] of Object.entries(pincodeMapData)) {
        if (val && typeof val === 'object' && (val as any).s && (val as any).s.toUpperCase().trim() === normalizedState) {
          pins.push(pin);
        }
      }
      return pins;
    };

    const getPincodesForCity = (cityName: string): string[] => {
      const normalizedCity = cityName.toUpperCase().trim();
      const pins: string[] = [];
      for (const [pin, val] of Object.entries(pincodeMapData)) {
        if (val && typeof val === 'object' && (val as any).d && (val as any).d.toUpperCase().trim() === normalizedCity) {
          pins.push(pin);
        }
      }
      return pins;
    };

    if (state && state !== 'All') {
      const stateSafe = state.replace(/'/g, "''");
      const mappedCities = Object.entries(cityToStateMap)
        .filter(([_, st]) => st.toUpperCase() === state.toUpperCase())
        .map(([c]) => c.replace(/'/g, "''"));
      
      const statePincodes = getPincodesForState(state);
      
      let stateCond = `(st.vname = '${stateSafe}'`;
      if (mappedCities.length > 0) {
        stateCond += ` OR cty.vname IN (${mappedCities.map(c => `'${c}'`).join(',')})`;
      } else {
        stateCond += `)`;
      }

      if (statePincodes.length > 0) {
        const pinsList = statePincodes.map(p => `'${p}'`).join(',');
        condition += ` AND (
          ${stateCond}
          OR (
            (st.vname IS NULL OR st.vname = '' OR st.vname = 'NA' OR st.vname = 'N/A' OR st.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      } else {
        condition += ` AND ${stateCond}`;
      }
    }

    if (city && city !== 'All') {
      const citySafe = city.replace(/'/g, "''");
      const cityPincodes = getPincodesForCity(city);
      if (cityPincodes.length > 0) {
        const pinsList = cityPincodes.map(p => `'${p}'`).join(',');
        condition += ` AND (
          (cty.vname = '${citySafe}')
          OR (
            (cty.vname IS NULL OR cty.vname = '' OR cty.vname = 'NA' OR cty.vname = 'N/A' OR cty.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      } else {
        condition += ` AND (cty.vname = '${citySafe}')`;
      }
    }

    if (branch && branch !== 'All') {
      const branchSafe = branch.replace(/'/g, "''");
      condition += ` AND tc.nofficeid = '${branchSafe}'`;
    }

    if (franchisee && franchisee !== 'All') {
      const franchiseeSafe = franchisee.replace(/'/g, "''");
      if (franchiseeSafe === 'UNASSIGNED') {
        condition += ` AND (tc.ntransfertooffice IS NULL OR tc.ntransfertooffice = 0)`;
      } else {
        condition += ` AND tc.ntransfertooffice = '${franchiseeSafe}'`;
      }
    }

    if (technician && technician !== 'All') {
      const technicianSafe = technician.replace(/'/g, "''");
      condition += ` AND tc.nengineer = '${technicianSafe}'`;
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
      tc.ncode as id,
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

    const offset = (page - 1) * limit;
    const fetchTotals = searchParams.get('fetchTotals') !== 'false'; // default true

    let summaryRes: any = { data: [{ total: 0, transferred: 0, cancelled: 0, solved: 0, open_calls: 0 }] };
    let filterOptionsRes: any = { data: [] };
    let res: any;

    const dataQuery = postQuery({
      fields,
      tableName,
      condition,
      orderBy: `tc.ncode DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    });

    if (fetchTotals) {
      const optionsQuery = postQuery({
        rawSql: `
          SELECT
            tc.nofficeid,
            o.vcompanyname as officename,
            tc.ntransfertooffice as franchisee_code,
            transferoffice.vcompanyname as franchisee_name,
            tc.nengineer,
            u.vname as technician_name,
            p.vinstpostalcode as Pincode,
            cty.vname as dbCity,
            st.vname as dbState,
            COUNT(*) as call_count
          FROM ${tableName}
          WHERE ${baseCondition}
          GROUP BY
            tc.nofficeid,
            o.vcompanyname,
            tc.ntransfertooffice,
            transferoffice.vcompanyname,
            tc.nengineer,
            u.vname,
            p.vinstpostalcode,
            cty.vname,
            st.vname
        `
      });

      [res, summaryRes, filterOptionsRes] = await Promise.all([
        dataQuery,
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
        }),
        optionsQuery
      ]);
    } else {
      res = await dataQuery;
    }

    const summary = summaryRes.data?.[0] || { total: 0, transferred: 0, cancelled: 0, solved: 0, open_calls: 0 };
    const totalCount = parseInt(summary.total || "0");

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

    const responsePayload: any = {
      data: processedData
    };

    if (fetchTotals) {
      responsePayload.total = totalCount;
      responsePayload.summary = {
        total: parseInt(summary.total || "0"),
        transferred: parseInt(summary.transferred || "0"),
        cancelled: parseInt(summary.cancelled || "0"),
        solved: parseInt(summary.solved || "0"),
        open: parseInt(summary.open_calls || "0")
      };

      // Process options
      const rawOptions = filterOptionsRes.data || [];
      const processedOptions = rawOptions.map((row: any) => {
        const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
        return {
          state: geo.state,
          city: geo.city,
          nofficeid: row.nofficeid ? String(row.nofficeid) : 'UNKNOWN',
          officename: row.officename || 'UNKNOWN',
          franchisee_code: row.franchisee_code ? String(row.franchisee_code) : 'UNASSIGNED',
          franchisee_name: row.franchisee_name || 'Unallocated',
          nengineer: row.nengineer ? String(row.nengineer) : '0',
          technician_name: row.technician_name || 'UNKNOWN',
          call_count: parseInt(row.call_count || '1')
        };
      });

      const criteria = {
        state: state || 'All',
        city: city || 'All',
        branch: branch || 'All',
        franchisee: franchisee || 'All',
        technician: technician || 'All'
      };

      // 1. States (exclude state filter)
      const statesFiltered = filterCallsCSR(processedOptions, criteria, 'state');
      const stateCounts: Record<string, { vname: string; call_count: number }> = {};
      statesFiltered.forEach((c) => {
        if (!c.state || c.state === 'UNKNOWN') return;
        const sName = c.state;
        stateCounts[sName] = stateCounts[sName] || { vname: sName, call_count: 0 };
        stateCounts[sName].call_count += c.call_count;
      });
      responsePayload.statesList = Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname));

      // 2. Cities (exclude city filter)
      const citiesFiltered = filterCallsCSR(processedOptions, criteria, 'city');
      const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
      citiesFiltered.forEach((c) => {
        if (!c.city || c.city === 'UNKNOWN') return;
        const cName = c.city;
        cityCounts[cName] = cityCounts[cName] || { ncode: cName, vname: cName, nstate: c.state || '', call_count: 0 };
        cityCounts[cName].call_count += c.call_count;
      });
      responsePayload.citiesList = Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname));

      // 3. Branches (exclude branch filter)
      const branchesFiltered = filterCallsCSR(processedOptions, criteria, 'branch');
      const branchCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
      branchesFiltered.forEach((c) => {
        if (!c.nofficeid || c.nofficeid === 'UNKNOWN') return;
        const bCode = c.nofficeid;
        branchCounts[bCode] = branchCounts[bCode] || { ncode: bCode, vcompanyname: c.officename, call_count: 0 };
        branchCounts[bCode].call_count += c.call_count;
      });
      responsePayload.branchesList = Object.values(branchCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));

      // 4. Franchisees (exclude franchisee filter)
      const franchiseesFiltered = filterCallsCSR(processedOptions, criteria, 'franchisee');
      const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
      franchiseesFiltered.forEach((c) => {
        const fCode = c.franchisee_code;
        franchiseeCounts[fCode] = franchiseeCounts[fCode] || { ncode: fCode, vcompanyname: c.franchisee_name, call_count: 0 };
        franchiseeCounts[fCode].call_count += c.call_count;
      });
      responsePayload.franchiseesList = Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));

      // 5. Technicians (exclude technician filter)
      const techniciansFiltered = filterCallsCSR(processedOptions, criteria, 'technician');
      const techCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
      techniciansFiltered.forEach((c) => {
        if (!c.nengineer || c.nengineer === '0') return;
        const tCode = c.nengineer;
        techCounts[tCode] = techCounts[tCode] || { ncode: tCode, vname: c.technician_name, call_count: 0 };
        techCounts[tCode].call_count += c.call_count;
      });
      responsePayload.techniciansList = Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname));
    }

    return NextResponse.json(responsePayload);

  } catch (error: any) {
    console.error('Report API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
