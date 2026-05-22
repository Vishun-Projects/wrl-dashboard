import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';
import {
  buildTrhcallsLookupCondition,
  buildTrhcallsLookupSubquery,
  enrichTrhcallBranchFranchisee,
  normalizeExactTrnSearch,
  sqlFranchiseeCodeExpr,
  sqlFranchiseeNameExpr,
  buildFranchiseeFilterSqlCondition,
  resolveRegisterDateSqlColumn,
  sqlRegisterDateColumn,
} from '@/lib/trhcalls-query';
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
  return normalizeExactTrnSearch(search);
}

function appendStatusFilter(
  condition: string,
  statusFilter: string,
  isHod: boolean,
  visibleStatuses: string[],
  skipWhenSearch: boolean
): { condition: string; forbidden?: boolean } {
  if (skipWhenSearch) return { condition };

  const statuses =
    statusFilter && statusFilter !== 'All'
      ? statusFilter.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  if (!isHod && visibleStatuses.length > 0) {
    if (statuses.length > 0) {
      const allowed = statuses.filter((s) => visibleStatuses.includes(s));
      if (allowed.length === 0) {
        return { condition, forbidden: true };
      }
      const statusConditions = allowed.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
      return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
    }
    const statusConditions = visibleStatuses.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
    return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
  }

  if (statuses.length > 0) {
    const statusConditions = statuses.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
    return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
  }
  return { condition };
}

function buildSingleStatusCondition(statusFilter: string): string {
  if (statusFilter === 'Open Unallocated') {
    return " AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
  }
  if (statusFilter === 'Assigned') {
    return " AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
  }
  if (statusFilter === 'Tech. Solve Call') {
    return " AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)";
  }
  if (statusFilter === 'Closed') {
    return " AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed')";
  }
  return '';
}

async function applyPortalFilter(condition: string, portalFilter: string | null): Promise<string> {
  if (!portalFilter || portalFilter === 'All') return condition;

  const filters = portalFilter.split(',').map((f) => f.trim()).filter(Boolean);
  if (filters.length === 0) return condition;

  const subConditions: string[] = [];
  for (const filter of filters) {
    let portalCallIds: string[] = [];
    if (filter === 'verified') {
      const { data } = await supabaseAdmin.from('call_flags').select('call_id').eq('flag_type', 'noted');
      portalCallIds = (data || []).map((d) => d.call_id);
    } else if (filter === 'rejected') {
      const { data } = await supabaseAdmin.from('call_flags').select('call_id').eq('flag_type', 'escalate');
      portalCallIds = (data || []).map((d) => d.call_id);
    } else if (filter === 'hold') {
      const { data } = await supabaseAdmin.from('call_flags').select('call_id').eq('flag_type', 'query');
      portalCallIds = (data || []).map((d) => d.call_id);
    } else if (filter === 'comments') {
      const { data } = await supabaseAdmin.from('call_comments').select('call_id');
      portalCallIds = Array.from(new Set((data || []).map((d) => d.call_id)));
    } else if (filter === 'unseen') {
      const { data } = await supabaseAdmin.from('call_flags').select('call_id').in('flag_type', ['noted', 'escalate', 'query']);
      portalCallIds = (data || []).map((d) => d.call_id);
      const numericIds = portalCallIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
      if (numericIds.length > 0) {
        subConditions.push(`tc.ncode NOT IN (${numericIds.join(',')})`);
      }
      continue;
    }

    const numericIds = portalCallIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
    if (numericIds.length > 0) {
      subConditions.push(`tc.ncode IN (${numericIds.join(',')})`);
    } else {
      subConditions.push('1=0');
    }
  }

  if (subConditions.length === 0) return condition;
  return `${condition} AND (${subConditions.join(' OR ')})`;
}

async function mergeAuditEnrichment(rows: any[]) {
  if (!rows.length) return rows;

  const callIds = rows.map((r) => String(r.id));
  const [flagsRes, commentsRes] = await Promise.all([
    supabaseAdmin.from('call_flags').select('call_id, flag_type').in('call_id', callIds),
    supabaseAdmin.from('call_comments').select('call_id, author_name, comment, content, created_at, author_id').in('call_id', callIds).order('created_at', { ascending: false }),
  ]);

  const flags = flagsRes.data || [];
  const comments = commentsRes.data || [];
  const authorIds = Array.from(new Set(comments.map((cm: any) => cm.author_id).filter(Boolean)));
  let authors: any[] = [];
  if (authorIds.length > 0) {
    const { data: authorsData } = await supabaseAdmin
      .from('app_users')
      .select('id, avatar_url')
      .in('id', authorIds);
    authors = authorsData || [];
  }

  return rows.map((row) => {
    const id = String(row.id);
    const callFlag = flags.find((f) => f.call_id === id);
    const callComments = comments
      .filter((cm) => cm.call_id === id)
      .map((cm) => {
        const author = authors.find((a: any) => a.id === cm.author_id);
        return {
          author_name: cm.author_name,
          comment: cm.comment || cm.content,
          created_at: cm.created_at,
          author_avatar_url: author?.avatar_url || null,
        };
      });

    return {
      ...row,
      audit_flag: callFlag?.flag_type || null,
      comment_count: callComments.length,
      comments: callComments,
      office_id: row.nofficeid ? String(row.nofficeid) : undefined,
    };
  });
}

function parseFilterList(val: string | undefined): string[] {
  if (!val || val === 'All') return [];
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function matchesFilterList(value: string, filterVal: string | undefined): boolean {
  const list = parseFilterList(filterVal);
  if (list.length === 0) return true;
  return list.includes(value);
}

function filterCallsCSR(calls: any[], criteria: any, exclude?: string) {
  return calls.filter((c) => {
    if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
      if (!matchesFilterList(c.state, criteria.state)) return false;
    }
    if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
      if (!matchesFilterList(c.city, criteria.city)) return false;
    }
    if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
      if (!matchesFilterList(String(c.nofficeid), criteria.branch)) return false;
    }
    if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
      if (!matchesFilterList(c.franchisee_code, criteria.franchisee)) return false;
    }
    if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
      if (!matchesFilterList(String(c.nengineer), criteria.technician)) return false;
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
    const dateFilterColumnParam = searchParams.get('dateFilterColumn') || 'dtrndate';
    const account = searchParams.get('account') || '';
    const region = searchParams.get('region') || '';
    const status = searchParams.get('status') || '';
    const pincode = searchParams.get('pincode') || '';
    const lastSync = searchParams.get('lastSync') || '';
    const priority = searchParams.get('priority') || 'all';
    const portalFilter = searchParams.get('portalFilter') || 'All';

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
      .select('office_ids, visible_statuses, role')
      .eq('id', user.id)
      .single();

    const assignedOffices = profile?.office_ids || [];
    const visibleStatuses = profile?.visible_statuses || [];

    const isHod = 
      permissions.includes('view_all_offices') || 
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    // Base condition is on raw table alias 'tc' — exclude transferred calls from all counts and listings
    const excludeTransferred = " AND ISNULL(tc.vtransfercallno, '') = '' AND ISNULL(tc.ncancelreason, 0) <> 2";
    const isLookupSearch = !!(search && search.trim());
    const registerDateCol = resolveRegisterDateSqlColumn(dateFilterColumnParam);
    const registerDateSql = sqlRegisterDateColumn(registerDateCol);

    let baseCondition: string;
    if (isLookupSearch) {
      baseCondition = buildTrhcallsLookupCondition(search);
    } else {
      baseCondition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${excludeTransferred}`;
    }

    if (!isLookupSearch) {
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
        baseCondition += ` AND ${registerDateSql} >= '${startDate}'`;
      }
      if (endDate) {
        baseCondition += ` AND ${registerDateSql} <= '${endDate} 23:59:59'`;
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

      const statusResult = appendStatusFilter(baseCondition, status, isHod, visibleStatuses, false);
      if (statusResult.forbidden) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      baseCondition = statusResult.condition;

      if (priority && priority !== 'all') {
        const priorities = priority.split(',').map((p) => p.trim()).filter((p) => p && p !== 'all');
        if (priorities.length === 1) {
          if (priorities[0] === 'major') {
            baseCondition += " AND EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
          } else if (priorities[0] === 'minor') {
            baseCondition += " AND NOT EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
          }
        }
      }

      if (pincode) {
        const pincodeSafe = pincode.replace(/'/g, "''");
        baseCondition += ` AND p.vinstpostalcode LIKE '%${pincodeSafe}%'`;
      }
    }

    if (lastSync) {
      baseCondition += ` AND ISNULL(tc.editedon, tc.addedon) >= '${lastSync.replace(/'/g, "''")}'`;
    }

    let condition = await applyPortalFilter(baseCondition, isLookupSearch ? 'All' : portalFilter);

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

    const buildSingleStateCondition = (stateName: string): string => {
      const stateSafe = stateName.replace(/'/g, "''");
      const mappedCities = Object.entries(cityToStateMap)
        .filter(([_, st]) => st.toUpperCase() === stateName.toUpperCase())
        .map(([c]) => c.replace(/'/g, "''"));

      const statePincodes = getPincodesForState(stateName);

      let stateCond = `(st.vname = '${stateSafe}'`;
      if (mappedCities.length > 0) {
        stateCond += ` OR cty.vname IN (${mappedCities.map((c) => `'${c}'`).join(',')})`;
      }
      stateCond += ')';

      if (statePincodes.length > 0) {
        const pinsList = statePincodes.map((p) => `'${p}'`).join(',');
        return `(
          ${stateCond}
          OR (
            (st.vname IS NULL OR st.vname = '' OR st.vname = 'NA' OR st.vname = 'N/A' OR st.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      }
      return stateCond;
    };

    const buildSingleCityCondition = (cityName: string): string => {
      const citySafe = cityName.replace(/'/g, "''");
      const cityPincodes = getPincodesForCity(cityName);
      if (cityPincodes.length > 0) {
        const pinsList = cityPincodes.map((p) => `'${p}'`).join(',');
        return `(
          (cty.vname = '${citySafe}')
          OR (
            (cty.vname IS NULL OR cty.vname = '' OR cty.vname = 'NA' OR cty.vname = 'N/A' OR cty.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      }
      return `(cty.vname = '${citySafe}')`;
    };

    if (!isLookupSearch && state && state !== 'All') {
      const states = state.split(',').map((s) => s.trim()).filter(Boolean);
      if (states.length === 1) {
        condition += ` AND ${buildSingleStateCondition(states[0])}`;
      } else if (states.length > 1) {
        condition += ` AND (${states.map((s) => buildSingleStateCondition(s)).join(' OR ')})`;
      }
    }

    if (!isLookupSearch && city && city !== 'All') {
      const cities = city.split(',').map((c) => c.trim()).filter(Boolean);
      if (cities.length === 1) {
        condition += ` AND ${buildSingleCityCondition(cities[0])}`;
      } else if (cities.length > 1) {
        condition += ` AND (${cities.map((c) => buildSingleCityCondition(c)).join(' OR ')})`;
      }
    }

    if (!isLookupSearch && branch && branch !== 'All') {
      const branches = branch.split(',').map((b) => b.trim()).filter(Boolean);
      if (branches.length === 1) {
        const branchSafe = branches[0].replace(/'/g, "''");
        condition += ` AND (tc.nofficeid = '${branchSafe}' OR o.nunder = '${branchSafe}')`;
      } else if (branches.length > 1) {
        const branchList = branches.map((b) => `'${b.replace(/'/g, "''")}'`).join(',');
        condition += ` AND (tc.nofficeid IN (${branchList}) OR o.nunder IN (${branchList}))`;
      }
    }

    if (!isLookupSearch && franchisee && franchisee !== 'All') {
      condition += buildFranchiseeFilterSqlCondition(franchisee);
    }

    if (!isLookupSearch && technician && technician !== 'All') {
      const techs = technician.split(',').map((t) => t.trim()).filter(Boolean);
      if (techs.length === 1) {
        const technicianSafe = techs[0].replace(/'/g, "''");
        condition += ` AND tc.nengineer = '${technicianSafe}'`;
      } else if (techs.length > 1) {
        condition += ` AND tc.nengineer IN (${techs.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`;
      }
    }

    // Direct table join matching the Calls register exactly
    const fields = `
      tc.vcclid as vcclid,
      CONVERT(varchar(30), tc.dtrndate, 126) as callsdtrndate,
      p.vname as PartyName,
      p.vinstpostalcode as Pincode,
      cty.vname as dbCity,
      st.vname as dbState,
      tc.ntransfertooffice as ntransfertooffice,
      ${sqlFranchiseeCodeExpr()} as franchisee_code,
      tc.vlocation as vlocation,
      mstitems.vitemcode as itemcode,
      mstitems.vname as itemname,
      tc.vserialno as callsvserialno,
      u.vname as serviceman,
      f.vcompanyname as technician_office_name,
      f.ncode as technician_office_id,
      transferoffice.vcompanyname as transfer_office_name,
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
      o.vcompanyname as office_name,
      o.nunder as office_under,
      bo.vcompanyname as branch_office_name,
      ${sqlFranchiseeNameExpr()} as franchisee_name,
      calltype_fs.vdisplayvalue as calltype,
      tc.vtransfercallno as vtransfercallno,
      tc.bfastclose as bfastclose,
      tc.nengineer as nengineer,
      tc.nofficeid as nofficeid,
      case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 'Yes' else 'No' end as bmreject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 'Yes' else 'No' end as horeject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 2 else case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 1 end end as rejectionstatus,
      tc.vcomment as vcomment,
      tc.vBMrejectreason as vBMrejectreason,
      cr.vname as cancel_reason,
      (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) as is_major_repair
    `;

    let subqueryCondition = "";
    if (lastSync) {
      subqueryCondition = `WHERE ISNULL(editedon, addedon) >= '${lastSync.replace(/'/g, "''")}'`;
      if (startDate) {
        subqueryCondition += ` AND ${registerDateCol} >= '${startDate.replace(/'/g, "''")}'`;
      }
    } else if (!isLookupSearch && (startDate || endDate)) {
      const dateParts: string[] = [];
      if (startDate) dateParts.push(`${registerDateCol} >= '${startDate.replace(/'/g, "''")}'`);
      if (endDate) dateParts.push(`${registerDateCol} <= '${endDate.replace(/'/g, "''")} 23:59:59'`);
      subqueryCondition = `WHERE ${dateParts.join(' AND ')}`;
    }

    const LATEST_CALLS_SUBQUERY =
      isLookupSearch && !lastSync
        ? buildTrhcallsLookupSubquery(search)
        : `(
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
      LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
      LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
      LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
      LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
      LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
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

      const processedData = await mergeAuditEnrichment(
        (res.data || []).map((row: any) => {
          const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
          return enrichTrhcallBranchFranchisee({
            ...row,
            state: geo.state,
            city: geo.city,
            technician_name: row.serviceman || 'UNKNOWN',
          });
        })
      );

      return NextResponse.json({
        data: processedData,
        isDelta: true,
      });
    }

    const offset = (page - 1) * limit;
    const fetchTotals = searchParams.get('fetchTotals') !== 'false'; // default true

    let summaryRes: any = {
      data: [{
        total: 0,
        cancelled: 0,
        solved: 0,
        open_calls: 0,
        open_unallocated: 0,
        assigned: 0,
        tech_solved: 0,
        closed: 0,
      }],
    };
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
            o.vcompanyname as office_name,
            o.nunder as office_under,
            bo.vcompanyname as branch_office_name,
            ${sqlFranchiseeCodeExpr()} as franchisee_code,
            ${sqlFranchiseeNameExpr()} as franchisee_name,
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
            o.nunder,
            bo.vcompanyname,
            ${sqlFranchiseeCodeExpr()},
            ${sqlFranchiseeNameExpr()},
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
            SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN tc.bsolved = 1 OR tc.bfastclose = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed' THEN 1 ELSE 0 END) as solved,
            SUM(CASE WHEN (tc.bsolved = 0 OR tc.bsolved IS NULL) AND (tc.bfastclose = 0 OR tc.bfastclose IS NULL) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls,
            SUM(CASE WHEN (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_unallocated,
            SUM(CASE WHEN (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND (tc.bfastclose = 'False' OR tc.bfastclose IS NULL OR tc.bfastclose = '0' OR tc.bfastclose = 0) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as assigned,
            SUM(CASE WHEN (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND (tc.bsolved = 'False' OR tc.bsolved IS NULL OR tc.bsolved = '0' OR tc.bsolved = 0) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as tech_solved,
            SUM(CASE WHEN (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR CAST(tc.callStatus AS NVARCHAR(MAX)) = 'Closed') THEN 1 ELSE 0 END) as closed
          `,
          tableName,
          condition
        }),
        optionsQuery
      ]);
    } else {
      res = await dataQuery;
    }

    const summary = summaryRes.data?.[0] || {
      total: 0,
      cancelled: 0,
      solved: 0,
      open_calls: 0,
      open_unallocated: 0,
      assigned: 0,
      tech_solved: 0,
      closed: 0,
    };
    const totalCount = parseInt(summary.total || "0");

    const processedData = await mergeAuditEnrichment(
      (res.data || []).map((row: any) => {
        const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
        return enrichTrhcallBranchFranchisee({
          ...row,
          state: geo.state,
          city: geo.city,
          technician_name: row.serviceman || 'UNKNOWN',
        });
      })
    );

    const responsePayload: any = {
      data: processedData,
    };

    if (fetchTotals) {
      responsePayload.total = totalCount;
      responsePayload.summary = {
        total: parseInt(summary.total || "0"),
        cancelled: parseInt(summary.cancelled || "0"),
        solved: parseInt(summary.solved || "0"),
        open: parseInt(summary.open_calls || "0"),
        openUnallocated: parseInt(summary.open_unallocated || "0"),
        assigned: parseInt(summary.assigned || "0"),
        techSolved: parseInt(summary.tech_solved || "0"),
        closed: parseInt(summary.closed || "0"),
      };

      // Process options
      const rawOptions = filterOptionsRes.data || [];
      const processedOptions = rawOptions.map((row: any) => {
        const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
        return enrichTrhcallBranchFranchisee({
          state: geo.state,
          city: geo.city,
          nofficeid: row.nofficeid ? String(row.nofficeid) : 'UNKNOWN',
          office_name: row.office_name,
          office_under: row.office_under,
          branch_office_name: row.branch_office_name,
          franchisee_code: row.franchisee_code,
          franchisee_name: row.franchisee_name,
          nengineer: row.nengineer ? String(row.nengineer) : '0',
          technician_name: row.technician_name || 'UNKNOWN',
          call_count: parseInt(row.call_count || '1'),
        });
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
        const bCode = c.resolved_branch_code || c.nofficeid;
        if (!bCode || bCode === 'UNKNOWN') return;
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
