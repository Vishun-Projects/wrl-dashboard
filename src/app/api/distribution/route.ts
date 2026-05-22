import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';
import { buildTrhcallsBaseCondition, buildTrhcallsDedupSubquery, buildTrhcallsDeltaSubquery, enrichTrhcallBranchFranchisee, sqlFranchiseeCodeExpr, sqlFranchiseeNameExpr } from '@/lib/trhcalls-query';
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

function isValidOfficeName(name: string): boolean {
  if (!name) return false;
  const normalized = name.toUpperCase().trim();
  if (normalized === 'NA' || normalized === 'N/A' || normalized === 'UNKNOWN' || normalized === 'TEST' || normalized === 'DUMMY' || normalized === '') return false;
  if (normalized.startsWith('Z ') || normalized.startsWith('Z-') || normalized === 'Z' || normalized.includes('Z_') || normalized.includes('Z CITY') || normalized.includes('Z BRANCH') || normalized.includes('Z FRANCHISEE')) return false;
  return true;
}

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
    isPincodeMapped = true;
  } else {
    if (isValidState(resolvedDbState)) {
      state = resolvedDbState;
    } else if (isValidState(mappedState)) {
      state = mappedState;
      isPincodeMapped = true;
    }

    if (isValidCity(resolvedDbCity)) {
      city = resolvedDbCity;
    } else if (isValidCity(mappedCity)) {
      city = mappedCity;
      isPincodeMapped = true;
    }
  }

  if (!isValidState(state)) state = 'UNKNOWN';
  if (!isValidCity(city)) city = 'UNKNOWN';

  // Coordinate lookup
  if (mapped && mapped.lat && mapped.lng) {
    const parsedLat = parseFloat(mapped.lat);
    const parsedLng = parseFloat(mapped.lng);
    if (parsedLat >= 8.0 && parsedLat <= 38.0 && parsedLng >= 68.0 && parsedLng <= 98.0) {
      lat = parsedLat;
      lng = parsedLng;
      hasCoords = true;
    }
  }

  // Database latlong fallback
  if (!hasCoords && dbLatLong && dbLatLong.includes(',')) {
    const parts = dbLatLong.split(',');
    let parsedLat = parseFloat(parts[0].trim());
    let parsedLng = parseFloat(parts[1].trim());

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

  state = state.toUpperCase().trim();
  city = city.toUpperCase().trim();

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
          hasCoords = false;
        } else {
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
  bypassCache: boolean = false,
  security: { isHod: boolean; assignedOffices: string[] } = { isHod: true, assignedOffices: [] }
) {
  const cacheKey = `${startDate || 'default'}_${endDate || 'default'}_${callType || 'All'}_${security.isHod ? 'hod' : security.assignedOffices.join('-')}`;
  const now = Date.now();

  if (!bypassCache && allCallsCache.has(cacheKey)) {
    const cached = allCallsCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
  }

  const whereClause = buildTrhcallsBaseCondition({
    startDate,
    endDate,
    callType,
    datesInSubquery: true,
    isHod: security.isHod,
    assignedOffices: security.assignedOffices,
  });

  const tableName = `
    ${buildTrhcallsDedupSubquery({ startDate, endDate })}
    JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
  `;

  const rawDataRes = await postQuery({
    fields: `
      tc.vcclid,
      tc.ncode,
      tc.ncancelreason,
      tc.ntransfertooffice,
      p.vinstpostalcode as pincode,
      COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) as latlong,
      ${sqlFranchiseeCodeExpr()} as franchisee_code,
      ${sqlFranchiseeNameExpr()} as franchisee_name,
      tc.vtrnno,
      tc.vserialno as callsvserialno,
      tc.vtransfercallno,
      tc.bsolved,
      tc.bfastclose,
      tc.nengineer,
      tc.nofficeid,
      o.nunder as office_under,
      o.vcompanyname as office_name,
      bo.vcompanyname as branch_office_name,
      u.vname as technician_name,
      f.vcompanyname as technician_office_name,
      f.ncode as technician_office_id,
      transferoffice.vcompanyname as transfer_office_name,
      cty.vname as db_city,
      st.vname as db_state
    `,
    tableName,
    condition: whereClause
  });

  const rawCalls = rawDataRes.data || [];

  const mapped = mapRawDistributionCalls(rawCalls);

  allCallsCache.set(cacheKey, { data: mapped, timestamp: now });
  return mapped;
}

function mapRawDistributionCalls(rawCalls: any[]) {
  return rawCalls.map((c: any) => {
    const geo = getGeographicDetails(c.pincode, c.latlong, c.db_city, c.db_state);
    return enrichTrhcallBranchFranchisee({
      ...c,
      state: geo.state,
      city: geo.city,
      lat: geo.lat,
      lng: geo.lng,
    });
  });
}

async function getMappedCallsDelta(
  startDate: string | null,
  endDate: string | null,
  callType: string | null,
  lastSync: string,
  security: { isHod: boolean; assignedOffices: string[] } = { isHod: true, assignedOffices: [] }
) {
  const whereClause = buildTrhcallsBaseCondition({
    startDate,
    endDate,
    callType,
    datesInSubquery: true,
    isHod: security.isHod,
    assignedOffices: security.assignedOffices,
  });

  const tableName = `
    ${buildTrhcallsDeltaSubquery(lastSync, startDate, endDate)}
    JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
  `;

  const rawDataRes = await postQuery({
    fields: `
      tc.vcclid,
      tc.ncode,
      tc.ncancelreason,
      tc.ntransfertooffice,
      p.vinstpostalcode as pincode,
      COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) as latlong,
      ${sqlFranchiseeCodeExpr()} as franchisee_code,
      ${sqlFranchiseeNameExpr()} as franchisee_name,
      tc.vtrnno,
      tc.vserialno as callsvserialno,
      tc.vtransfercallno,
      tc.bsolved,
      tc.bfastclose,
      tc.nengineer,
      tc.nofficeid,
      o.nunder as office_under,
      o.vcompanyname as office_name,
      bo.vcompanyname as branch_office_name,
      u.vname as technician_name,
      f.vcompanyname as technician_office_name,
      f.ncode as technician_office_id,
      transferoffice.vcompanyname as transfer_office_name,
      cty.vname as db_city,
      st.vname as db_state
    `,
    tableName,
    condition: whereClause
  });

  return mapRawDistributionCalls(rawDataRes.data || []);
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
    const callType = searchParams.get('callType') || 'All';
    const bypassCache = searchParams.get('refresh') === 'true';
    const lastSync = searchParams.get('lastSync');

    const permissions = await (prisma as any).getUserPermissions(user.id);
    const userProfileResult = await prisma.$queryRawUnsafe(
      'SELECT office_ids, role FROM public.app_users WHERE id = $1 LIMIT 1',
      user.id
    );
    const profile = (userProfileResult as any[])?.[0];
    const assignedOffices = profile?.office_ids || [];
    const isHod =
      permissions.includes('view_all_offices') ||
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    const security = { isHod, assignedOffices };

    if (lastSync) {
      const deltaCalls = await getMappedCallsDelta(startDate, endDate, callType, lastSync, security);
      return NextResponse.json({
        deltaCalls,
        isDelta: true,
      });
    }

    let allCalls: Awaited<ReturnType<typeof getMappedCalls>> = [];
    let degraded = false;
    try {
      allCalls = await getMappedCalls(startDate, endDate, callType, bypassCache, security);
    } catch (loadErr: unknown) {
      const body =
        typeof (loadErr as { response?: { data?: unknown } })?.response?.data === 'string'
          ? String((loadErr as { response?: { data?: string } }).response?.data)
          : '';
      const isOom =
        body.includes('OutOfMemoryException') ||
        body.includes('OutOfMemory') ||
        String(loadErr).includes('memory');
      if (!isOom) throw loadErr;
      degraded = true;
      console.warn('Distribution full load degraded (CRM OOM); returning empty calls.');
    }

    // Fetch branches directly from CRM based on user permissions

    let officeCondition = "nunder IN (605, 606, 607, 608, 612, 1, 0) OR nunder IS NULL";
    if (!isHod && assignedOffices.length > 0) {
      const ids = assignedOffices.map((id: string) => `'${id}'`).join(',');
      officeCondition = `(ncode IN (${ids}) OR nunder IN (${ids}))`;
    }

    const branchesDbRes = await postQuery({
      fields: 'ncode, vcompanyname, nunder',
      tableName: 'mstoffice (NOLOCK)',
      condition: officeCondition,
      orderBy: 'vcompanyname ASC'
    });
    const dbBranches = branchesDbRes.data || [];

    return NextResponse.json({
      allCalls,
      dbBranches,
      ...(degraded
        ? {
            degraded: true,
            warning:
              'CRM could not load all calls for this range. Try Last 7 Days or a shorter custom range.',
          }
        : {}),
    });

  } catch (err: any) {
    console.error('Call Distribution Error:', err);
    const responseBody =
      typeof err?.response?.data === 'string'
        ? err.response.data
        : JSON.stringify(err?.response?.data ?? '');
    const isOom =
      responseBody.includes('OutOfMemoryException') || responseBody.includes('OutOfMemory');
    return NextResponse.json(
      {
        error: isOom
          ? 'CRM database ran out of memory for this date range. Try a shorter range (e.g. 7 days).'
          : err.message || 'Distribution query failed',
      },
      { status: isOom ? 503 : 500 }
    );
  }
}
