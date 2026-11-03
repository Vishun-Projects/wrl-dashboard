import type { Mb51AgingMovement } from '@/modules/mb51-aging/types';

/**
 * Stable fingerprint for one MB51 movement line.
 * Used to skip lines already present from another file / earlier upload —
 * not to collapse duplicates inside a single file.
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

/**
 * Keep every in-file copy. Drop a line only when its fingerprint is already
 * in `existing` (loaded from DB before this upload / file).
 */
export function filterMb51AgainstExisting(
  rows: Mb51AgingMovement[],
  existing: Set<string>
): { rows: Mb51AgingMovement[]; skipped: number } {
  if (!rows.length) return { rows, skipped: 0 };
  if (!existing.size) return { rows, skipped: 0 };
  const out: Mb51AgingMovement[] = [];
  for (const r of rows) {
    if (existing.has(mb51MovementDedupeKey(r))) continue;
    out.push(r);
  }
  return { rows: out, skipped: rows.length - out.length };
}

/**
 * @deprecated Prefer filterMb51AgainstExisting — in-file duplicates must be kept.
 * Kept for older checks that still assert unique collapsing.
 */
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
