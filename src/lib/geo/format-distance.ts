/** Human-readable distance from meters (e.g. "1.25 km", "450 m"). */
export function formatDistanceMeters(m: number, suffix = ''): string {
  const base = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  return suffix ? `${base}${suffix}` : base;
}
