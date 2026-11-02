import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

/**
 * Stable key for one MB51 movement line within an import.
 * Same doc + plant + material + movement + date + qty + vendor + uom + text
 * → treated as the same entry (append / re-upload must not double-count).
 */
export function mb51MovementDedupeKey(r: Mb51AgingMovement): string {
  return [
    r.dc ?? '',
    r.mv ?? '',
    r.m ?? '',
    r.mt ?? '',
    String(r.d ?? 0),
    String(Number(r.q) || 0),
    r.v ?? '',
    r.u ?? '',
    r.tx ?? '',
  ].join('\u0001');
}

/** Keep first occurrence; drop later identical lines. */
export function dedupeMb51Movements(rows: Mb51AgingMovement[]): {
  rows: Mb51AgingMovement[];
  skipped: number;
} {
  if (rows.length <= 1) return { rows, skipped: 0 };
  const seen = new Set<string>();
  const out: Mb51AgingMovement[] = [];
  for (const r of rows) {
    const k = mb51MovementDedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return { rows: out, skipped: rows.length - out.length };
}
