import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';
import pincodeMapData from '../../report/distribution/pincode_map.json';

// Server-side in-memory cache to optimize filter changing response times
const allCallsCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

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

const stateCenters: Record<string, [number, number]> = {
  'MAHARASHTRA': [19.7515, 75.7139],
  'GUJARAT': [22.2587, 71.1924],
  'RAJASTHAN': [27.0238, 74.2179],
  'MADHYA PRADESH': [22.9734, 78.6569],
  'DELHI': [28.7041, 77.1025],
  'KARNATAKA': [15.3173, 75.7139],
  'TAMIL NADU': [11.1271, 78.6569],
  'ANDHRA PRADESH': [15.9129, 79.7400],
  'TELANGANA': [18.1124, 79.0193],
  'UTTAR PRADESH': [26.8467, 80.9462],
  'WEST BENGAL': [22.9868, 87.8550],
  'HARYANA': [29.0588, 76.0856],
  'PUNJAB': [31.1471, 75.3412],
  'KERALA': [10.8505, 76.2711],
  'BIHAR': [25.0961, 85.3131],
  'JHARKHAND': [23.6102, 85.2799],
  'CHHATTISGARH': [21.2787, 81.8661],
  'ODISHA': [20.9517, 85.0985],
  'ASSAM': [26.2006, 92.9376],
  'UTTARAKHAND': [30.0668, 79.0193],
  'GOA': [15.2993, 74.1240]
};

const cityCenters: Record<string, [number, number]> = {
  'MUMBAI': [19.0760, 72.8777],
  'PUNE': [18.5204, 73.8567],
  'AHMEDABAD': [23.0225, 72.5714],
  'SURAT': [21.1702, 72.8311],
  'VADODARA': [22.3072, 73.1812],
  'RAJKOT': [22.3039, 70.8022],
  'JAIPUR': [26.9124, 75.7873],
  'BENGALURU': [12.9716, 77.5946],
  'BANGALORE': [12.9716, 77.5946],
  'CHENNAI': [13.0827, 80.2707],
  'HYDERABAD': [17.3850, 78.4867],
  'KOLKATA': [22.5726, 88.3639],
  'INDORE': [22.7196, 75.8577],
  'NAGPUR': [21.1458, 79.0882],
  'NASHIK': [19.9975, 73.7898]
};

const prefixCenters: Record<string, [number, number]> = {
  '400': [19.0760, 72.8777], // Mumbai City
  '401': [19.2183, 72.9781], // Thane / Palghar
  '402': [18.5158, 73.1812], // Raigad
  '410': [18.7500, 73.4000], // Lonavala / Pune rural
  '411': [18.5204, 73.8567], // Pune City
  '412': [18.4900, 74.1300], // Pune Rural / Uruli
  '413': [17.6599, 75.9064], // Solapur
  '414': [19.0948, 74.7480], // Ahmednagar
  '415': [17.6805, 73.9918], // Satara
  '416': [16.7050, 74.2433], // Kolhapur / Sangli
  '421': [19.2354, 73.1291], // Kalyan / Dombivli
  '422': [19.9975, 73.7898], // Nashik
  '423': [20.5500, 74.5300], // Malegaon
  '424': [20.9000, 74.7800], // Dhule
  '425': [21.0077, 75.5626], // Jalgaon
  '430': [19.8762, 75.3433], // Aurangabad
  '431': [19.1000, 77.3000], // Nanded / Jalna / Beed
  '440': [21.1458, 79.0882], // Nagpur
  '441': [21.1700, 79.6500], // Nagpur Rural / Bhandara
  '442': [20.7453, 78.6022], // Wardha
  '443': [20.4600, 76.8200], // Buldhana
  '444': [20.7002, 77.0082], // Akola / Amravati
  '445': [20.3888, 78.1228], // Yavatmal
  '110': [28.6139, 77.2090], // Delhi
  '380': [23.0225, 72.5714], // Ahmedabad
  '382': [23.2156, 72.6369], // Gandhinagar
  '390': [22.3072, 73.1812], // Vadodara
  '395': [21.1702, 72.8311], // Surat
  '360': [22.3039, 70.8022], // Rajkot
  '560': [12.9716, 77.5946], // Bengaluru
  '570': [12.2958, 76.6394], // Mysore
  '580': [15.3647, 75.1240], // Hubli
  '600': [13.0827, 80.2707], // Chennai
  '641': [11.0168, 76.9558], // Coimbatore
  '625': [9.9252, 78.1198], // Madurai
  '500': [17.3850, 78.4867], // Hyderabad
  '520': [16.5062, 80.6480], // Vijayawada
  '530': [17.6868, 83.2185]  // Visakhapatnam
};

const stateBounds: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  'MAHARASHTRA': { minLat: 15.5, maxLat: 22.2, minLng: 72.5, maxLng: 81.0 },
  'GUJARAT': { minLat: 20.1, maxLat: 24.8, minLng: 68.0, maxLng: 74.8 },
  'RAJASTHAN': { minLat: 23.0, maxLat: 30.3, minLng: 69.4, maxLng: 78.4 },
  'MADHYA PRADESH': { minLat: 21.0, maxLat: 27.0, minLng: 74.0, maxLng: 82.9 },
  'DELHI': { minLat: 28.3, maxLat: 28.9, minLng: 76.8, maxLng: 77.4 },
  'KARNATAKA': { minLat: 11.4, maxLat: 18.6, minLng: 74.0, maxLng: 78.6 },
  'TAMIL NADU': { minLat: 8.0, maxLat: 13.7, minLng: 76.1, maxLng: 80.4 },
  'ANDHRA PRADESH': { minLat: 12.9, maxLat: 19.1, minLng: 75.9, maxLng: 84.1 },
  'TELANGANA': { minLat: 15.5, maxLat: 20.0, minLng: 77.1, maxLng: 81.7 },
  'UTTAR PRADESH': { minLat: 23.8, maxLat: 31.6, minLng: 77.0, maxLng: 84.8 },
  'WEST BENGAL': { minLat: 21.5, maxLat: 27.3, minLng: 85.7, maxLng: 90.0 },
  'HARYANA': { minLat: 27.5, maxLat: 31.1, minLng: 74.3, maxLng: 77.7 },
  'PUNJAB': { minLat: 29.4, maxLat: 32.7, minLng: 73.8, maxLng: 77.1 },
  'KERALA': { minLat: 8.2, maxLat: 12.9, minLng: 74.7, maxLng: 77.5 },
  'BIHAR': { minLat: 24.2, maxLat: 27.6, minLng: 83.2, maxLng: 88.4 },
  'JHARKHAND': { minLat: 21.8, maxLat: 25.2, minLng: 83.2, maxLng: 88.0 },
  'CHHATTISGARH': { minLat: 17.6, maxLat: 24.4, minLng: 80.1, maxLng: 84.5 },
  'ODISHA': { minLat: 17.7, maxLat: 22.7, minLng: 81.3, maxLng: 87.6 },
  'ASSAM': { minLat: 24.0, maxLat: 28.3, minLng: 89.6, maxLng: 96.2 },
  'UTTARAKHAND': { minLat: 28.4, maxLat: 31.7, minLng: 77.2, maxLng: 81.3 },
  'GOA': { minLat: 14.8, maxLat: 15.9, minLng: 73.5, maxLng: 74.5 }
};

function getGeographicDetails(pincode: string, dbLatLong?: string, dbCity?: string, dbState?: string) {
  const pin = String(pincode || '').trim();
  
  let state = '';
  let city = '';
  let lat = 20.5937;
  let lng = 78.9629;
  let hasCoords = false;
  let isPincodeMapped = false;

  // Lookup in our pincode map
  const mapped = (pincodeMapData as Record<string, any>)[pin];
  if (mapped) {
    state = mapped.s || '';
    city = mapped.d || '';
    isPincodeMapped = true;
    if (mapped.lat && mapped.lng) {
      const parsedLat = parseFloat(mapped.lat);
      const parsedLng = parseFloat(mapped.lng);
      // Enforce strict India boundaries
      if (parsedLat >= 8.0 && parsedLat <= 38.0 && parsedLng >= 68.0 && parsedLng <= 98.0) {
        lat = parsedLat;
        lng = parsedLng;
        hasCoords = true;
      }
    }
  }

  // Database latlong fallback
  if (!hasCoords && dbLatLong && dbLatLong.includes(',')) {
    const parts = dbLatLong.split(',');
    let parsedLat = parseFloat(parts[0].trim());
    let parsedLng = parseFloat(parts[1].trim());

    // Swapped lat/lng check
    if (parsedLat >= 68.0 && parsedLat <= 98.0 && parsedLng >= 8.0 && parsedLng <= 38.0) {
      const temp = parsedLat;
      parsedLat = parsedLng;
      parsedLng = temp;
    }

    if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
      if (parsedLat >= 8.0 && parsedLat <= 38.0 && parsedLng >= 68.0 && parsedLng <= 98.0) {
        lat = parsedLat;
        lng = parsedLng;
        hasCoords = true;
      }
    }
  }

  // Fallbacks for state & city names
  if (!state) state = dbState || 'UNKNOWN';
  if (!city) city = dbCity || 'UNKNOWN';

  state = state.toUpperCase().trim();
  city = city.toUpperCase().trim();

  // Correct city-to-state mapping mismatches from the database
  if (cityToStateMap[city]) {
    state = cityToStateMap[city];
  }

  // Validate state bounds if we have coords
  if (hasCoords) {
    const bounds = stateBounds[state];
    if (bounds) {
      const inside = lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
      if (!inside) {
        if (isPincodeMapped) {
          // Trusted state from pincode map, but coordinates are bad -> clear coordinate so it falls back to center
          hasCoords = false;
        } else {
          // Database fallback state might be wrong (e.g. branch fallback) while coords are right.
          // Scan other states to see if coordinate belongs to a different state.
          let foundMatchingState = false;
          let bestState = state;
          let minDistance = Infinity;
          for (const [stName, stBnd] of Object.entries(stateBounds)) {
            if (lat >= stBnd.minLat && lat <= stBnd.maxLat && lng >= stBnd.minLng && lng <= stBnd.maxLng) {
              const center = stateCenters[stName];
              if (center) {
                const dist = Math.pow(lat - center[0], 2) + Math.pow(lng - center[1], 2);
                if (dist < minDistance) {
                  minDistance = dist;
                  bestState = stName;
                  foundMatchingState = true;
                }
              } else {
                if (minDistance === Infinity) {
                  bestState = stName;
                  foundMatchingState = true;
                }
              }
            }
          }
          if (foundMatchingState) {
            state = bestState;
          } else {
            hasCoords = false;
          }
        }
      }
    } else {
      // General India bounds fallback check if state bounds are not defined
      if (!(lat >= 8.0 && lat <= 38.0 && lng >= 68.0 && lng <= 98.0)) {
        hasCoords = false;
      }
    }
  }

  // If no valid coordinates, calculate center coordinates with scatter
  if (!hasCoords) {
    const prefix = pin.substring(0, 3);
    let baseCoords: [number, number] = [20.5937, 78.9629];
    if (prefixCenters[prefix]) {
      baseCoords = prefixCenters[prefix];
    } else if (cityCenters[city]) {
      baseCoords = cityCenters[city];
    } else if (stateCenters[state]) {
      baseCoords = stateCenters[state];
    }

    // Deterministic scatter using pincode hash so pins don't stack directly
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
      hash = pin.charCodeAt(i) + ((hash << 5) - hash);
    }
    const scatterLat = ((hash % 13) / 13 - 0.5) * 0.05;
    const scatterLng = ((hash % 17) / 17 - 0.5) * 0.05;

    lat = baseCoords[0] + scatterLat;
    lng = baseCoords[1] + scatterLng;
  }

  return { state, city, lat, lng };
}

function filterCalls(calls: any[], criteria: {
  state: string | null;
  city: string | null;
  branch: string | null;
  franchisee: string | null;
  technician: string | null;
}, exclude?: string) {
  return calls.filter((c) => {
    if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
      if (c.state !== criteria.state.toUpperCase()) return false;
    }
    if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
      if (c.city !== criteria.city.toUpperCase()) return false;
    }
    if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
      if (String(c.resolved_branch_code) !== criteria.branch) return false;
    }
    if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
      const cFranCode = c.franchisee_code ? String(c.franchisee_code) : 'UNASSIGNED';
      if (cFranCode !== criteria.franchisee) return false;
    }
    if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
      if (String(c.nengineer) !== criteria.technician) return false;
    }
    return true;
  });
}

async function getMappedCalls(
  startDate: string | null,
  endDate: string | null,
  callType: string | null,
  bypassCache: boolean = false
) {
  const cacheKey = `${startDate || 'default'}_${endDate || 'default'}_${callType || 'All'}`;
  const now = Date.now();

  if (!bypassCache && allCallsCache.has(cacheKey)) {
    const cached = allCallsCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  let whereClause = "tc.ncancelreason IS NULL";

  if (callType && callType !== 'All') {
    const callTypeSafe = callType.replace(/'/g, "''");
    whereClause += ` AND tc.ncalltype = (SELECT TOP 1 ncode FROM mstfixedselection WHERE vfieldname = 'ncalltype' AND vdisplayvalue = '${callTypeSafe}')`;
  }

  if (startDate && endDate) {
    const startSafe = startDate.replace(/'/g, "''");
    const endSafe = endDate.replace(/'/g, "''");
    whereClause += ` AND tc.dtrndate >= '${startSafe}' AND tc.dtrndate <= '${endSafe} 23:59:59'`;
  } else {
    whereClause += ` AND tc.dtrndate >= DATEADD(day, -30, GETDATE())`;
  }

  const rawDataRes = await postQuery({
    fields: `
      tc.ntrnno,
      p.vinstpostalcode as pincode,
      COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) as latlong,
      CASE 
        WHEN o.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND o.nunder IS NOT NULL THEN o.ncode 
        WHEN f.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND f.nunder IS NOT NULL THEN f.ncode
        ELSE NULL 
      END as franchisee_code,
      CASE 
        WHEN o.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND o.nunder IS NOT NULL THEN o.vcompanyname 
        WHEN f.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND f.nunder IS NOT NULL THEN f.vcompanyname
        ELSE 'Unallocated' 
      END as franchisee_name,
      tc.vtrnno,
      tc.vtransfercallno,
      tc.bsolved,
      tc.bfastclose,
      tc.nengineer,
      tc.nofficeid,
      o.nunder as office_under,
      o.vcompanyname as office_name,
      bo.vcompanyname as branch_office_name,
      u.vname as technician_name,
      u.nofficeid as technician_office_id,
      cty.vname as db_city,
      st.vname as db_state
    `,
    tableName: `
      trhcalls tc (NOLOCK)
      JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
      LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
      LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
      LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
      LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
      LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
      LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    `,
    condition: whereClause
  });

  const rawCalls = rawDataRes.data || [];

  const mapped = rawCalls.map((c: any) => {
    const geo = getGeographicDetails(c.pincode, c.latlong, c.db_city, c.db_state);
    const isParentFranchisee = c.office_under && ![605, 606, 607, 608, 612, 1, 0].includes(Number(c.office_under));
    const resolvedBranchCode = isParentFranchisee ? String(c.office_under) : String(c.nofficeid);
    const resolvedBranchName = isParentFranchisee ? c.branch_office_name : c.office_name;
    return {
      ...c,
      state: geo.state,
      city: geo.city,
      lat: geo.lat,
      lng: geo.lng,
      resolved_branch_code: resolvedBranchCode,
      resolved_branch_name: resolvedBranchName
    };
  });

  allCallsCache.set(cacheKey, { data: mapped, timestamp: now });
  return mapped;
}

export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate the user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fetchType = searchParams.get('fetch');
    const isMeta = searchParams.get('meta') === 'true';

    // 2. Metadata loading route (optimized to only query call types)
    if (isMeta) {
      const callTypesRes = await postQuery({
        fields: 'DISTINCT ncode, vdisplayvalue',
        tableName: 'mstfixedselection (NOLOCK)',
        condition: "vfieldname = 'ncalltype' AND vdisplayvalue IS NOT NULL",
        orderBy: 'vdisplayvalue ASC'
      });

      return NextResponse.json({
        callTypes: callTypesRes.data || []
      });
    }

    // 3. Consolidated Data and Filter options query route
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const state = searchParams.get('state');
    const city = searchParams.get('city');
    const branch = searchParams.get('branch');
    const franchisee = searchParams.get('franchisee');
    const technician = searchParams.get('technician');
    const callType = searchParams.get('callType') || 'BREAKDOWN';
    const bypassCache = searchParams.get('refresh') === 'true';

    const criteria = {
      state,
      city,
      branch,
      franchisee,
      technician
    };

    // Query database ONCE for the date range & call type (without SQL-level filtering on branch/franchisee/technician)
    // so we can compute full cascades in memory.
    const allCalls = await getMappedCalls(startDate, endDate, callType, bypassCache);

    // Fetch branches directly from CRM based on user permissions
    const permissions = await (prisma as any).getUserPermissions(user.id);
    const userProfileResult = await prisma.$queryRawUnsafe(
      'SELECT office_ids, role FROM public.app_users WHERE id = $1 LIMIT 1',
      user.id
    );
    const profile = (userProfileResult as any[])?.[0];
    const assignedOffices = profile?.office_ids || [];
    const isHod = 
      permissions.includes('view_all_offices') || 
      permissions.includes('view_reports') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    let officeCondition = "nunder IN (605, 606, 607, 608, 612, 1, 0) OR nunder IS NULL";
    if (!isHod && assignedOffices.length > 0) {
      officeCondition = `(${officeCondition}) AND ncode IN (${assignedOffices.map((id: string) => `'${id}'`).join(',')})`;
    }

    const branchesDbRes = await postQuery({
      fields: 'ncode, vcompanyname',
      tableName: 'mstoffice (NOLOCK)',
      condition: officeCondition,
      orderBy: 'vcompanyname ASC'
    });
    const dbBranches = branchesDbRes.data || [];

    // A. Compute individual dropdown option lists in memory (cascaded based on active criteria)
    
    // States (exclude state filter)
    const statesFiltered = filterCalls(allCalls, criteria, 'state');
    const stateCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
    statesFiltered.forEach((c) => {
      if (!c.state) return;
      const sName = c.state;
      if (!stateCounts[sName]) {
        stateCounts[sName] = { ncode: sName, vname: sName, call_count: 0 };
      }
      stateCounts[sName].call_count++;
    });
    const states = Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname));

    // Cities (exclude city filter)
    const citiesFiltered = filterCalls(allCalls, criteria, 'city');
    const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
    citiesFiltered.forEach((c) => {
      if (!c.city) return;
      const cName = c.city;
      if (!cityCounts[cName]) {
        cityCounts[cName] = { ncode: cName, vname: cName, nstate: c.state || '', call_count: 0 };
      }
      cityCounts[cName].call_count++;
    });
    const cities = Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname));

    // Branches (exclude branch filter) - Fetch directly from database and map call counts
    const branchesFiltered = filterCalls(allCalls, criteria, 'branch');
    const branchCallCounts: Record<string, number> = {};
    branchesFiltered.forEach((c) => {
      if (!c.resolved_branch_code) return;
      const bCode = String(c.resolved_branch_code);
      branchCallCounts[bCode] = (branchCallCounts[bCode] || 0) + 1;
    });

    const branches = dbBranches.map((dbB: any) => {
      const bCode = String(dbB.ncode);
      return {
        ncode: bCode,
        vcompanyname: dbB.vcompanyname,
        call_count: branchCallCounts[bCode] || 0
      };
    }).filter((b: any) => b.call_count > 0);

    // Franchisees (exclude franchisee filter)
    const franchiseesFiltered = filterCalls(allCalls, criteria, 'franchisee');
    const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; nunder: string; call_count: number }> = {};
    franchiseesFiltered.forEach((c) => {
      const fCode = String(c.franchisee_code || 'UNASSIGNED');
      const fName = c.franchisee_name || 'Unallocated';
      if (!franchiseeCounts[fCode]) {
        franchiseeCounts[fCode] = { ncode: fCode, vcompanyname: fName, nunder: String(c.office_under || ''), call_count: 0 };
      }
      franchiseeCounts[fCode].call_count++;
    });
    const franchisees = Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));

    // Technicians (exclude technician filter)
    const techniciansFiltered = filterCalls(allCalls, criteria, 'technician');
    const techCounts: Record<string, { ncode: string; vname: string; nofficeid: string; call_count: number }> = {};
    techniciansFiltered.forEach((c) => {
      if (!c.nengineer || c.nengineer === '0' || c.nengineer === 0) return;
      const tCode = String(c.nengineer);
      if (!techCounts[tCode]) {
        techCounts[tCode] = { ncode: tCode, vname: c.technician_name || 'UNKNOWN', nofficeid: String(c.technician_office_id || ''), call_count: 0 };
      }
      techCounts[tCode].call_count++;
    });
    const technicians = Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname));

    // B. Handle backward compatible/fallback legacy fetch calls if needed
    if (fetchType) {
      if (fetchType === 'states') return NextResponse.json(states);
      if (fetchType === 'cities') return NextResponse.json(cities);
      if (fetchType === 'branches') return NextResponse.json(branches);
      if (fetchType === 'franchisees') return NextResponse.json(franchisees);
      if (fetchType === 'technicians') return NextResponse.json(technicians);
    }

    // C. Aggregate data metrics and map coordinates (using all filters applied)
    const filteredCalls = filterCalls(allCalls, criteria);

    const franchiseeMap = new Map();
    const pincodeMap = new Map();

    let totalCallsCount = 0;
    let openCallsCount = 0;
    let closedCallsCount = 0;
    const activeTechsSet = new Set();
    const activeFranchiseesSet = new Set();

    filteredCalls.forEach((c: any) => {
      totalCallsCount++;
      const isSolved = c.bsolved === true || c.bsolved === 1 || String(c.bsolved).toLowerCase() === 'true';
      const isTechSolved = c.bfastclose === true || c.bfastclose === 1 || String(c.bfastclose).toLowerCase() === 'true';
      // Consider tech-solved as closed for metrics
      if (isSolved || isTechSolved) {
        closedCallsCount++;
      } else {
        openCallsCount++;
      }

      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        activeTechsSet.add(c.nengineer);
      }

      const fCode = c.franchisee_code || 'UNASSIGNED';
      const fName = c.franchisee_name || 'Unallocated';
      if (c.franchisee_code) {
        activeFranchiseesSet.add(c.franchisee_code);
      }

      // 1. Franchisee aggregate calculations
      if (!franchiseeMap.has(fCode)) {
        franchiseeMap.set(fCode, {
          franchisee_code: fCode,
          franchisee_name: fName,
          techs: new Set(),
          total_calls: 0,
          open_calls: 0,
          closed_calls: 0,
          tech_solved: 0
        });
      }
      const fObj = franchiseeMap.get(fCode);
      fObj.total_calls++;
      if (isSolved) {
        fObj.closed_calls++;
      } else if (isTechSolved) {
        // Count tech-solved separately but treat as closed
        fObj.closed_calls++;
        fObj.tech_solved++;
      } else {
        fObj.open_calls++;
      }
      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        fObj.techs.add(c.nengineer);
      }

      // 2. Pincode aggregate calculations for Leaflet map
      const pincode = c.pincode || 'UNKNOWN';
      const pinKey = `${pincode}-${fCode}`;

      if (!pincodeMap.has(pinKey)) {
        pincodeMap.set(pinKey, {
          pincode,
          lat: c.lat,
          lng: c.lng,
          city_name: c.city,
          state_name: c.state,
          franchisee_name: fName,
          franchisee_code: fCode,
          total_calls: 0,
          open_calls: 0
        });
      }
      const pinObj = pincodeMap.get(pinKey);
      pinObj.total_calls++;
      if (!isSolved) {
        pinObj.open_calls++;
      }
    });

    // Format franchisee breakdown results
    const detailMap = new Map();

    filteredCalls.forEach((c: any) => {
      const pincode = c.pincode || 'UNKNOWN';
      const city = c.city || 'UNKNOWN';
      const branchName = c.resolved_branch_name || 'Unknown Branch';
      const franchiseeName = c.franchisee_name || 'Unallocated';
      const franchiseeCode = c.franchisee_code || 'UNASSIGNED';
      const vtrnno = c.vtrnno || 'N/A';
      const isSolved = c.bsolved === true || c.bsolved === 1 || String(c.bsolved).toLowerCase() === 'true';
      const isTechSolved = c.bfastclose === true || c.bfastclose === 1 || String(c.bfastclose).toLowerCase() === 'true';
      const isUnallocated = franchiseeCode === 'UNASSIGNED';
      const statusKey = isUnallocated ? 'UNALLOCATED' : (!isSolved && !isTechSolved ? 'OPEN' : 'CLOSED');
      const detailKey = `${pincode}||${city}||${branchName}||${franchiseeName}||${vtrnno}||${statusKey}`;

      if (!detailMap.has(detailKey)) {
        detailMap.set(detailKey, {
          pincode,
          city,
          branch: branchName,
          franchisee: franchiseeName,
          franchisee_code: franchiseeCode,
          vtrnno,
          status: statusKey === 'UNALLOCATED' ? 'Unallocated' : statusKey === 'OPEN' ? 'Open' : 'Closed',
          count: 0
        });
      }
      detailMap.get(detailKey).count++;
    });

    const details = Array.from(detailMap.values());

    const franchiseeSummary = Array.from(franchiseeMap.values()).map((f: any) => {
      const techCount = f.techs.size;
      const ratio = techCount > 0 ? parseFloat((f.total_calls / techCount).toFixed(2)) : f.total_calls;
      return {
        franchisee_code: f.franchisee_code,
        franchisee_name: f.franchisee_name,
        technicians_count: techCount,
        total_calls: f.total_calls,
        open_calls: f.open_calls,
        closed_calls: f.closed_calls,
        tech_solved: f.tech_solved || 0,
        ratio
      };
    });

    // Sort by ratio DESC by default
    franchiseeSummary.sort((a, b) => b.ratio - a.ratio);

    // Format pincode summary for heatmap dots
    const pincodeFinalMap = new Map();
    pincodeMap.forEach((pin: any) => {
      if (!pincodeFinalMap.has(pin.pincode)) {
        pincodeFinalMap.set(pin.pincode, {
          pincode: pin.pincode,
          lat: pin.lat,
          lng: pin.lng,
          city_name: pin.city_name,
          state_name: pin.state_name,
          total_calls: 0,
          open_calls: 0,
          franchisees: []
        });
      }
      const pf = pincodeFinalMap.get(pin.pincode);
      pf.total_calls += pin.total_calls;
      pf.open_calls += pin.open_calls;
      pf.franchisees.push({
        franchisee_name: pin.franchisee_name,
        franchisee_code: pin.franchisee_code,
        total_calls: pin.total_calls
      });
    });

    // Format final list of pincodes with coordinates
    const pincodeSummary = Array.from(pincodeFinalMap.values()).map((pin: any) => {
      return {
        pincode: pin.pincode,
        lat: pin.lat,
        lng: pin.lng,
        total_calls: pin.total_calls,
        open_calls: pin.open_calls,
        franchisees: pin.franchisees
      };
    });

    return NextResponse.json({
      metrics: {
        totalCalls: totalCallsCount,
        openCalls: openCallsCount,
        closedCalls: closedCallsCount,
        franchiseesCount: activeFranchiseesSet.size,
        activeTechniciansCount: activeTechsSet.size,
        callToTechnicianRatio: activeTechsSet.size > 0 ? parseFloat((totalCallsCount / activeTechsSet.size).toFixed(2)) : totalCallsCount
      },
      franchiseeSummary,
      pincodeSummary,
      details,
      states,
      cities,
      branches,
      franchisees,
      technicians
    });

  } catch (err: any) {
    console.error('Call Distribution Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
