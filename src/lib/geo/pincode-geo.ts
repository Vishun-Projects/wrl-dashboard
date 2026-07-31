import { getPincodeMapData } from '@/lib/geo/pincode-map';
import { enrichTrhcallBranchFranchisee } from '@/sql/trhcalls/query';

export const UNASSIGNED_FRANCHISEE_CODE = 'UNASSIGNED';
export const UNALLOCATED_FRANCHISEE_NAME = 'Unallocated';

type PincodeMapEntry = { city?: string; state?: string; d?: string; s?: string; lat?: number | string | null; lng?: number | string | null };

export function applyPincodeGeo(row: Record<string, unknown>): Record<string, unknown> {
  const pin = String(row.pincode ?? row.Pincode ?? '').trim();
  const mapped = getPincodeMapData()[pin] as PincodeMapEntry | undefined;
  const state = String(mapped?.state ?? mapped?.s ?? row.state ?? '').toUpperCase();
  const city = String(mapped?.city ?? mapped?.d ?? row.city ?? '').toUpperCase();
  const latRaw = mapped?.lat ?? row.lat;
  const lngRaw = mapped?.lng ?? row.lng;
  const lat = latRaw != null ? Number(latRaw) : undefined;
  const lng = lngRaw != null ? Number(lngRaw) : undefined;
  return {
    ...row,
    state,
    city,
    ...(lat != null && !Number.isNaN(Number(lat)) ? { lat: Number(lat) } : {}),
    ...(lng != null && !Number.isNaN(Number(lng)) ? { lng: Number(lng) } : {}),
  };
}

export function enrichCallsWithGeo(calls: Record<string, unknown>[]): Record<string, unknown>[] {
  return calls.map(applyPincodeGeo);
}

/** Pincode geo + branch/franchisee enrichment for corpus, serial-audit, and register rows. */
export function enrichCallRowForReport(row: Record<string, unknown>): Record<string, unknown> {
  return enrichTrhcallBranchFranchisee({
    ...applyPincodeGeo(row),
    franchisee_code: row.franchisee_code ?? UNASSIGNED_FRANCHISEE_CODE,
    franchisee_name: row.franchisee_name ?? UNALLOCATED_FRANCHISEE_NAME,
  });
}

/** Pincode-map centroid for install address on a call (fast; no external geocoder). */
export function resolveInstallAddressCoords(parts: {
  pincode?: string | null;
  city?: string | null;
  state?: string | null;
}): { lat: number; lng: number } | null {
  const pin = String(parts.pincode ?? '').trim();
  if (!pin) return null;
  const geo = applyPincodeGeo({
    pincode: pin,
    city: parts.city ?? '',
    state: parts.state ?? '',
  });
  const lat = geo.lat != null ? Number(geo.lat) : null;
  const lng = geo.lng != null ? Number(geo.lng) : null;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}
