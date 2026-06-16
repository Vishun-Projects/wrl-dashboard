import 'server-only';

import { getPincodeMapData } from '@/lib/geo/pincode-map';

export const CITY_TO_STATE_MAP: Record<string, string> = {
  MUMBAI: 'MAHARASHTRA',
  PUNE: 'MAHARASHTRA',
  AHMEDABAD: 'GUJARAT',
  SURAT: 'GUJARAT',
  VADODARA: 'GUJARAT',
  RAJKOT: 'GUJARAT',
  JAIPUR: 'RAJASTHAN',
  BENGALURU: 'KARNATAKA',
  BANGALORE: 'KARNATAKA',
  CHENNAI: 'TAMIL NADU',
  HYDERABAD: 'TELANGANA',
  KOLKATA: 'WEST BENGAL',
  INDORE: 'MADHYA PRADESH',
  NAGPUR: 'MAHARASHTRA',
  NASHIK: 'MAHARASHTRA',
  AURANGABAD: 'MAHARASHTRA',
  KOLHAPUR: 'MAHARASHTRA',
  SOLAPUR: 'MAHARASHTRA',
  THANE: 'MAHARASHTRA',
  NAVIMUMBAI: 'MAHARASHTRA',
  'NAVI MUMBAI': 'MAHARASHTRA',
  BHANDARA: 'MAHARASHTRA',
};

const VALID_INDIAN_STATES = new Set([
  'ANDHRA PRADESH',
  'ARUNACHAL PRADESH',
  'ASSAM',
  'BIHAR',
  'CHHATTISGARH',
  'GOA',
  'GUJARAT',
  'HARYANA',
  'HIMACHAL PRADESH',
  'JHARKHAND',
  'KARNATAKA',
  'KERALA',
  'MADHYA PRADESH',
  'MAHARASHTRA',
  'MANIPUR',
  'MEGHALAYA',
  'MIZORAM',
  'NAGALAND',
  'ODISHA',
  'PUNJAB',
  'RAJASTHAN',
  'SIKKIM',
  'TAMIL NADU',
  'TELANGANA',
  'TRIPURA',
  'UTTAR PRADESH',
  'UTTARAKHAND',
  'WEST BENGAL',
  'ANDAMAN AND NICOBAR ISLANDS',
  'CHANDIGARH',
  'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'LAKSHADWEEP',
  'DELHI',
  'PUDUCHERRY',
  'JAMMU & KASHMIR',
  'JAMMU AND KASHMIR',
  'LADAKH',
]);

const STATE_NAME_CORRECTIONS: Record<string, string> = {
  TAMILNADU: 'TAMIL NADU',
  WESTBENGAL: 'WEST BENGAL',
  MADHYAPRADESH: 'MADHYA PRADESH',
  ANDHRAPRADESH: 'ANDHRA PRADESH',
  UTTARPRADESH: 'UTTAR PRADESH',
  UTTARAKHAND: 'UTTARAKHAND',
  CHATTISGARH: 'CHHATTISGARH',
  ODISHA: 'ODISHA',
  ORISSA: 'ODISHA',
  DELHI: 'DELHI',
  'NEW DELHI': 'DELHI',
  PONDICHERRY: 'PUDUCHERRY',
  PUDUCHERRY: 'PUDUCHERRY',
  JAMMU: 'JAMMU & KASHMIR',
  KASHMIR: 'JAMMU & KASHMIR',
  'JAMMU AND KASHMIR': 'JAMMU & KASHMIR',
  'JAMMU & KASHMIR': 'JAMMU & KASHMIR',
  'DADRA & NAGAR HAVELI': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'DAMAN & DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
  'DAMAN AND DIU': 'DADRA AND NAGAR HAVELI AND DAMAN AND DIU',
};

function correctStateName(normalized: string): string {
  if (STATE_NAME_CORRECTIONS[normalized]) return STATE_NAME_CORRECTIONS[normalized];
  const spaceLess = normalized.replace(/\s+/g, '');
  if (STATE_NAME_CORRECTIONS[spaceLess]) return STATE_NAME_CORRECTIONS[spaceLess];
  return normalized;
}

function isValidState(s: string): boolean {
  if (!s) return false;
  const normalized = s.toUpperCase().trim();
  if (
    normalized === 'NA' ||
    normalized === 'N/A' ||
    normalized === 'UNKNOWN' ||
    normalized === 'Z CITY' ||
    normalized === 'Z-CITY' ||
    normalized === ''
  ) {
    return false;
  }
  return VALID_INDIAN_STATES.has(correctStateName(normalized));
}

function isValidCity(c: string): boolean {
  if (!c) return false;
  const normalized = c.toUpperCase().trim();
  if (
    normalized === 'NA' ||
    normalized === 'N/A' ||
    normalized === 'UNKNOWN' ||
    normalized === 'Z CITY' ||
    normalized === 'Z-CITY' ||
    normalized === 'TEST' ||
    normalized === 'DUMMY' ||
    normalized === ''
  ) {
    return false;
  }
  if (
    normalized.startsWith('Z ') ||
    normalized.startsWith('Z-') ||
    normalized === 'Z' ||
    normalized.includes('Z_')
  ) {
    return false;
  }
  return true;
}

export function getGeographicDetails(
  pincode: string,
  dbCity?: string,
  dbState?: string
): { state: string; city: string } {
  const pin = String(pincode || '').trim();

  let state = '';
  let city = '';

  const mapped = getPincodeMapData()[pin];

  let mappedState = mapped?.s || '';
  let mappedCity = mapped?.d || '';

  if (mappedState) {
    mappedState = correctStateName(mappedState.toUpperCase().trim());
  }

  const dbStateUpper = (dbState || '').toUpperCase().trim();
  const resolvedDbState = dbStateUpper ? correctStateName(dbStateUpper) : '';
  const resolvedDbCity = (dbCity || '').toUpperCase().trim();

  if (isValidState(resolvedDbState) && isValidCity(resolvedDbCity)) {
    state = resolvedDbState;
    city = resolvedDbCity;
  } else if (isValidState(mappedState) && isValidCity(mappedCity)) {
    state = mappedState;
    city = mappedCity;
  } else {
    if (isValidState(resolvedDbState)) state = resolvedDbState;
    else if (isValidState(mappedState)) state = mappedState;

    if (isValidCity(resolvedDbCity)) city = resolvedDbCity;
    else if (isValidCity(mappedCity)) city = mappedCity;
  }

  if (!isValidState(state)) state = 'UNKNOWN';
  if (!isValidCity(city)) city = 'UNKNOWN';

  state = state.toUpperCase().trim();
  city = city.toUpperCase().trim();

  if (CITY_TO_STATE_MAP[city]) {
    state = CITY_TO_STATE_MAP[city];
  }

  return { state, city };
}
