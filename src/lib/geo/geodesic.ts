/** Great-circle arc points for map polylines (follows globe curvature). */
export function geodesicArc(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  segments = 64
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const λ1 = toRad(lng1);
  const φ2 = toRad(lat2);
  const λ2 = toRad(lng2);
  const cosΔ =
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const Δσ = Math.acos(Math.min(1, Math.max(-1, cosΔ)));
  if (Δσ < 1e-10) return [[lat1, lng1], [lat2, lng2]];

  const sinΔ = Math.sin(Δσ);
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.sin((1 - t) * Δσ) / sinΔ;
    const b = Math.sin(t * Δσ) / sinΔ;
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    points.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return points;
}

export function geodesicMidpoint(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): [number, number] {
  const arc = geodesicArc(lat1, lng1, lat2, lng2, 2);
  return arc[1] ?? arc[0];
}

export function formatDistanceMeters(m: number, suffix = ''): string {
  const base = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  return suffix ? `${base}${suffix}` : base;
}
