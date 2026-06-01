export type LatLng = { lat: number; lng: number };

/** Parse CRM "lat,lng" string with India bounds check and lat/lng swap correction. */
export function parseLatLongString(latlong: string | null | undefined): LatLng | null {
  const raw = String(latlong ?? '').trim();
  if (!raw.includes(',')) return null;
  const parts = raw.split(',');
  let lat = parseFloat(parts[0]?.trim() ?? '');
  let lng = parseFloat(parts[1]?.trim() ?? '');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat >= 68 && lat <= 98 && lng >= 8 && lng <= 38) {
    const temp = lat;
    lat = lng;
    lng = temp;
  }
  if (lat >= 8 && lat <= 38 && lng >= 68 && lng <= 98) {
    return { lat, lng };
  }
  return null;
}

/** Parse from row using `latlong` or explicit vlatlong/mlatlong fields. */
export function parseLatLngFromRow(row: Record<string, unknown>): LatLng | null {
  const combined = String(row.latlong ?? '').trim();
  if (combined) {
    const parsed = parseLatLongString(combined);
    if (parsed) return parsed;
  }
  const vlat = parseLatLongString(String(row.vlatlong ?? ''));
  if (vlat) return vlat;
  return parseLatLongString(String(row.mlatlong ?? ''));
}

export type CrmGpsSource = 'vlatlong' | 'mlatlong' | null;

/** User-facing label for stored GPS capture channel. */
export function formatGpsSourceForDisplay(source: CrmGpsSource | string | null | undefined): string {
  if (source === 'vlatlong') return 'Web / online capture';
  if (source === 'mlatlong') return 'Mobile capture';
  if (!source) return 'Not recorded';
  return String(source);
}

/** Prefer vlatlong (web/online), then mlatlong (mobile). */
export function parseCrmGpsFromPartyFields(row: Record<string, unknown>): {
  coords: LatLng | null;
  source: CrmGpsSource;
} {
  const vlat = parseLatLongString(String(row.vlatlong ?? ''));
  if (vlat) return { coords: vlat, source: 'vlatlong' };
  const mlat = parseLatLongString(String(row.mlatlong ?? ''));
  if (mlat) return { coords: mlat, source: 'mlatlong' };
  return { coords: null, source: null };
}

export type VisitGpsSource = 'vstartlatlong' | 'vendlatlong' | 'mlatlong' | null;

/** Latest visit capture: start → end → mobile. */
export function parseVisitGpsFromFields(row: Record<string, unknown>): {
  coords: LatLng | null;
  source: VisitGpsSource;
} {
  const start = parseLatLongString(String(row.vstartlatlong ?? ''));
  if (start) return { coords: start, source: 'vstartlatlong' };
  const end = parseLatLongString(String(row.vendlatlong ?? ''));
  if (end) return { coords: end, source: 'vendlatlong' };
  const mobile = parseLatLongString(String(row.mlatlong ?? ''));
  if (mobile) return { coords: mobile, source: 'mlatlong' };
  return { coords: null, source: null };
}
