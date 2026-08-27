/** Maps "lat,lng" text to a Google Maps URL, or null if unparseable. */
export function mapsUrlFromLatLong(latlong: string | null | undefined): string | null {
  if (!latlong) return null;
  const parts = latlong
    .split(/[, ]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
