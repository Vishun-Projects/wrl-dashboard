import 'server-only';

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { distanceMeters } from '@/lib/geo/haversine';
import { getIndiaPincode, isValidPincode, type IndiaPincode } from 'india-pincode';

type AreaOffice = {
  area: string;
  latitude: number | null;
  longitude: number | null;
};

let pinApi: IndiaPincode | null = null;

/**
 * Load validated India Post dataset. Uses package loader (requires dataset on disk).
 * createRequire fallback keeps __dirname correct if the ESM import is bundled.
 */
function getPinApi(): IndiaPincode {
  if (pinApi) return pinApi;
  try {
    pinApi = getIndiaPincode();
  } catch {
    const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
    pinApi = nodeRequire('india-pincode').getIndiaPincode() as IndiaPincode;
  }
  return pinApi;
}

/** India bounds: fix datasets that store lat/lng reversed. */
function normalizeIndiaCoords(lat: number, lng: number): { lat: number; lng: number } {
  if (lat >= 68 && lat <= 98 && lng >= 8 && lng <= 40) {
    return { lat: lng, lng: lat };
  }
  return { lat, lng };
}

function coordsFromOffice(latitude: number | null, longitude: number | null): { lat: number; lng: number } | null {
  if (latitude == null || longitude == null) return null;
  let lat = Number(latitude);
  let lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  ({ lat, lng } = normalizeIndiaCoords(lat, lng));
  if (lat < 6 || lat > 38 || lng < 68 || lng > 98) return null;
  return { lat, lng };
}

export function normalizePincodeForCompare(pin: string): string {
  const digits = String(pin ?? '').replace(/\D/g, '');
  if (digits.length >= 6) return digits.slice(0, 6);
  return digits;
}

/** Last 6-digit pincode-like token in free-text address. */
export function extractPincodeFromAddress(address: string): string {
  const matches = String(address ?? '').match(/\b([1-9]\d{5})\b/g);
  if (!matches?.length) return '';
  return normalizePincodeForCompare(matches[matches.length - 1]);
}

type NearbyPincodeHit = {
  pincode: string;
  area: string;
  district: string;
  state: string;
  distanceKm: number;
};

function normalizeStateKey(state: string): string {
  return String(state ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const NEARBY_PINCODE_LIMIT = 30;
const MAX_INSTALL_PINCODE_KM = 25;
const MAX_STATE_MATCH_KM = 25;

/** If GPS is within this distance of install city/pincode area, do not flag pincode-only fraud. */
export const PINCODE_FRAUD_MAX_PROXIMITY_KM = 8;

export type InstallAreaLookupOpts = {
  installPincode?: string;
  installState?: string;
  installCity?: string;
  address?: string;
};

function normalizePlaceKey(place: string): string {
  return String(place ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function districtMatchesInstallCity(district: string, installCity: string): boolean {
  const d = normalizePlaceKey(district);
  const c = normalizePlaceKey(installCity);
  if (!d || !c || c === 'UNKNOWN') return false;
  return d === c || d.includes(c) || c.includes(d);
}

function collectNearbyHits(
  la: number,
  ln: number,
  radiusKm: number
): NearbyPincodeHit[] {
  const pin = getPinApi();
  const res = pin.findNearby(la, ln, radiusKm, NEARBY_PINCODE_LIMIT);
  if (!res.success || !res.data?.length) return [];
  return res.data.map((hit) => ({
    pincode: hit.pincode,
    area: hit.area,
    district: hit.district,
    state: hit.state,
    distanceKm: hit.distanceKm,
  }));
}

function pickPincodeFromNearbyHits(
  hits: NearbyPincodeHit[],
  opts?: InstallAreaLookupOpts
): NearbyPincodeHit | null {
  if (!hits.length) return null;

  const installPin = normalizePincodeForCompare(opts?.installPincode ?? '');
  const installState = normalizeStateKey(opts?.installState ?? '');
  const installCity = normalizePlaceKey(opts?.installCity ?? '');

  if (installPin) {
    const installHits = hits.filter(
      (h) =>
        normalizePincodeForCompare(h.pincode) === installPin &&
        h.distanceKm <= MAX_INSTALL_PINCODE_KM
    );
    if (installHits.length) {
      return installHits.reduce((best, h) => (h.distanceKm < best.distanceKm ? h : best));
    }
  }

  if (installCity) {
    const cityHits = hits.filter(
      (h) => districtMatchesInstallCity(h.district, installCity) && h.distanceKm <= MAX_STATE_MATCH_KM
    );
    if (cityHits.length) {
      return cityHits.reduce((best, h) => (h.distanceKm < best.distanceKm ? h : best));
    }
  }

  if (installState) {
    const stateHits = hits.filter(
      (h) => normalizeStateKey(h.state) === installState && h.distanceKm <= MAX_STATE_MATCH_KM
    );
    if (stateHits.length) {
      return stateHits.reduce((best, h) => (h.distanceKm < best.distanceKm ? h : best));
    }
  }

  return hits[0];
}

/** Min distance (km) from GPS to install pincode offices or install city/district post offices nearby. */
export function gpsProximityToInstallAreaKm(
  lat: number,
  lng: number,
  opts?: InstallAreaLookupOpts
): number | null {
  const { lat: la, lng: ln } = normalizeIndiaCoords(lat, lng);
  if (la < 6 || la > 38 || ln < 68 || ln > 98) return null;

  let minM = Infinity;
  const installPin = normalizePincodeForCompare(opts?.installPincode ?? '');
  const installCity = normalizePlaceKey(opts?.installCity ?? '');

  if (installPin) {
    const pin = getPinApi();
    const summary = pin.getPincodeSummary(installPin);
    if (summary.success && summary.data?.areas) {
      for (const area of summary.data.areas) {
        const c = coordsFromOffice(area.latitude, area.longitude);
        if (!c) continue;
        minM = Math.min(minM, distanceMeters(la, ln, c.lat, c.lng));
      }
    }
  }

  for (const radiusKm of [25, 60]) {
    const hits = collectNearbyHits(la, ln, radiusKm);
    for (const hit of hits) {
      if (installPin && normalizePincodeForCompare(hit.pincode) === installPin) {
        minM = Math.min(minM, hit.distanceKm * 1000);
      }
      if (installCity && districtMatchesInstallCity(hit.district, installCity)) {
        minM = Math.min(minM, hit.distanceKm * 1000);
      }
    }
    if (minM < Infinity) break;
  }

  if (!Number.isFinite(minM)) return null;
  return Math.round((minM / 1000) * 100) / 100;
}

/**
 * Pincode for stored GPS using India Post findNearby.
 * When install pincode/state are known, prefers a nearby office in that pincode/state
 * over a closer wrong-state row (e.g. 245208 UP vs 124507 Haryana at Bahadurgarh).
 */
export function lookupPincodeAtCoords(
  lat: number,
  lng: number,
  opts?: InstallAreaLookupOpts
): NearbyPincodeHit | null {
  const { lat: la, lng: ln } = normalizeIndiaCoords(lat, lng);
  if (la < 6 || la > 38 || ln < 68 || ln > 98) return null;

  for (const radiusKm of [12, 25, 60]) {
    const hits = collectNearbyHits(la, ln, radiusKm);
    const picked = pickPincodeFromNearbyHits(hits, opts);
    if (picked) return picked;
  }
  return null;
}

function normalizePin(pin: string): string {
  return normalizePincodeForCompare(pin);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Tokens too generic to match post-office name → address (e.g. "Surat" in "…SURAT,Surat"). */
const GENERIC_AREA_TOKENS = new Set([
  'surat',
  'district',
  'court',
  'nagar',
  'road',
  'street',
  'colony',
  'sector',
  'phase',
  'ward',
  'city',
  'town',
  'village',
  'india',
  'state',
  'head',
  'office',
  'post',
  'sub',
  'so',
  'bo',
  'ho',
  'gpo',
]);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Drop India Post offices with GPS far from the rest of the pincode (bad dataset rows). */
function filterPincodeCoordOutliers(areas: AreaOffice[]): {
  inliers: AreaOffice[];
  excluded: string[];
} {
  const withCoords = areas.filter(
    (a) =>
      a.latitude != null &&
      a.longitude != null &&
      coordsFromOffice(a.latitude, a.longitude) != null
  );
  if (withCoords.length <= 1) {
    return { inliers: withCoords, excluded: [] };
  }

  const pts = withCoords.map((a) => coordsFromOffice(a.latitude, a.longitude)!);
  const medLat = median(pts.map((p) => p.lat));
  const medLng = median(pts.map((p) => p.lng));

  const inliers: AreaOffice[] = [];
  const excluded: string[] = [];
  const maxFromClusterM = 35_000;

  for (const office of withCoords) {
    const c = coordsFromOffice(office.latitude, office.longitude)!;
    const dist = distanceMeters(c.lat, c.lng, medLat, medLng);
    if (dist <= maxFromClusterM) {
      inliers.push(office);
    } else {
      excluded.push(office.area);
    }
  }

  if (inliers.length === 0) {
    return { inliers: withCoords, excluded: [] };
  }
  return { inliers, excluded };
}

function scoreAreaAgainstAddress(address: string, area: string): number {
  const addr = address.toLowerCase();
  const areaNorm = area.toLowerCase().trim();
  if (!areaNorm) return 0;
  if (addr.includes(areaNorm)) return 100;
  const areaTokens = tokenize(areaNorm).filter((t) => !GENERIC_AREA_TOKENS.has(t));
  if (areaTokens.length === 0) return 0;
  let hits = 0;
  for (const t of areaTokens) {
    if (addr.includes(t)) hits++;
  }
  return (hits / areaTokens.length) * 50;
}

function pickOfficeForAddress(
  address: string,
  areas: AreaOffice[]
): { lat: number; lng: number; matchedArea: string; method: string } | null {
  const { inliers, excluded } = filterPincodeCoordOutliers(areas);
  if (inliers.length === 0) return null;

  const outlierNote =
    excluded.length > 0
      ? ` (excluded ${excluded.length} outlier GPS in dataset: ${excluded.slice(0, 2).join(', ')}${excluded.length > 2 ? '…' : ''})`
      : '';

  let best = inliers[0];
  let bestScore = scoreAreaAgainstAddress(address, best.area);
  for (const office of inliers) {
    const score = scoreAreaAgainstAddress(address, office.area);
    if (score > bestScore) {
      best = office;
      bestScore = score;
    }
  }

  if (bestScore >= 25) {
    const c = coordsFromOffice(best.latitude, best.longitude);
    if (!c) return null;
    return {
      lat: c.lat,
      lng: c.lng,
      matchedArea: best.area,
      method: `India Post — matched post office area to install address${outlierNote}`,
    };
  }

  const normalized = inliers
    .map((a) => coordsFromOffice(a.latitude, a.longitude))
    .filter((c): c is { lat: number; lng: number } => c != null);
  if (normalized.length === 0) return null;

  const lat = normalized.reduce((s, a) => s + a.lat, 0) / normalized.length;
  const lng = normalized.reduce((s, a) => s + a.lng, 0) / normalized.length;
  return {
    lat,
    lng,
    matchedArea: `${normalized.length} offices (pincode centroid)`,
    method: `India Post — average of post offices in pincode${outlierNote}`,
  };
}

export type IndiaPostGeocodeResult =
  | {
      ok: true;
      lat: number;
      lng: number;
      source: string;
      matchedArea: string;
      district: string;
      state: string;
    }
  | { ok: false; reason: string };

/** Resolve install address using India Post post-office dataset (offline, ~165k offices). */
export function geocodeAddressFromIndiaPost(parts: {
  address: string;
  pincode: string;
  city?: string;
  state?: string;
}): IndiaPostGeocodeResult {
  const address = String(parts.address ?? '').trim();
  const pincode = normalizePin(parts.pincode ?? '');
  if (!address || address.length < 5) {
    return { ok: false, reason: 'Install address missing or too short' };
  }
  if (!pincode || !isValidPincode(pincode)) {
    return { ok: false, reason: `Invalid or missing pincode: ${pincode || '(empty)'}` };
  }

  const pin = getPinApi();
  const summary = pin.getPincodeSummary(pincode);
  if (!summary.success || !summary.data) {
    const byPin = pin.getByPincode(pincode, { limit: 20 });
    if (byPin.success && byPin.data?.data?.length) {
      const areas: AreaOffice[] = byPin.data.data.map((o) => ({
        area: o.area,
        latitude: o.latitude,
        longitude: o.longitude,
      }));
      const picked = pickOfficeForAddress(address, areas);
      if (picked) {
        const first = byPin.data.data[0];
        const c = coordsFromOffice(picked.lat, picked.lng) ?? { lat: picked.lat, lng: picked.lng };
        return {
          ok: true,
          lat: c.lat,
          lng: c.lng,
          source: picked.method,
          matchedArea: picked.matchedArea,
          district: first.district,
          state: first.state,
        };
      }
    }
    return { ok: false, reason: `Pincode ${pincode} not found in India Post dataset` };
  }

  const areas: AreaOffice[] = summary.data.areas.map((a) => ({
    area: a.area,
    latitude: a.latitude,
    longitude: a.longitude,
  }));

  const picked = pickOfficeForAddress(address, areas);
  if (!picked) {
    return {
      ok: false,
      reason: `Pincode ${pincode} found but no GPS on file for post offices`,
    };
  }

  return {
    ok: true,
    lat: picked.lat,
    lng: picked.lng,
    source: picked.method,
    matchedArea: picked.matchedArea,
    district: summary.data.district,
    state: summary.data.state,
  };
}

export function getIndiaPostDatasetStats() {
  const pin = getPinApi();
  return {
    totalRecords: pin.getTotalRecords(),
    totalPincodes: pin.getTotalPincodes(),
  };
}
