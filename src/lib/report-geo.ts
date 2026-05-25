import pincodeMapData from '@/app/report/distribution/pincode_map.json';

type PincodeMapEntry = { city?: string; state?: string; d?: string; s?: string; lat?: number | string | null; lng?: number | string | null };

export function applyPincodeGeo(row: Record<string, unknown>): Record<string, unknown> {
  const pin = String(row.pincode ?? row.Pincode ?? '').trim();
  const mapped = (pincodeMapData as unknown as Record<string, PincodeMapEntry>)[pin];
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
