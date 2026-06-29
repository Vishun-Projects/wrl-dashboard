/** Normalize client region labels to CRM-style NORTH/EAST/WEST/SOUTH. */

const REGION_ALIASES: Record<string, string> = {
  N: 'NORTH',
  NORTH: 'NORTH',
  E: 'EAST',
  EAST: 'EAST',
  W: 'WEST',
  WEST: 'WEST',
  S: 'SOUTH',
  SOUTH: 'SOUTH',
};

const ZONE_LABELS = ['NORTH', 'EAST', 'WEST', 'SOUTH'] as const;

export function isKnownZone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const key = raw.toUpperCase().replace(/\s*ZONE\s*$/i, '').trim();
  return ZONE_LABELS.includes(key as (typeof ZONE_LABELS)[number]);
}

export function normalizeClientRegion(raw: string | null | undefined): string {
  if (!raw) return 'OTHER';
  const upper = raw.trim().toUpperCase();
  if (REGION_ALIASES[upper]) return REGION_ALIASES[upper];
  if (upper.includes('NORTH')) return 'NORTH';
  if (upper.includes('EAST')) return 'EAST';
  if (upper.includes('WEST')) return 'WEST';
  if (upper.includes('SOUTH')) return 'SOUTH';
  return 'OTHER';
}

/** CRM-style region label for display (NORTH → NORTH ZONE). */
export function formatDisplayRegion(raw: string | null | undefined): string {
  if (!raw) return 'OTHER';
  const zone = normalizeClientRegion(raw);
  if (!isKnownZone(zone)) return 'OTHER';
  return `${zone} ZONE`;
}
