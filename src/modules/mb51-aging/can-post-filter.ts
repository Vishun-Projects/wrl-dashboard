import type { Mb51AgingReportParams } from '@/modules/mb51-aging/types';

function sameSorted(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.every((v, i) => v === bb[i]);
}

/**
 * True when `next` can be applied by filtering already-materialized agg rows
 * of `snap` (no FIFO recompute).
 *
 * Excludes are post-filters: next may exclude *more* than snap, but cannot
 * un-exclude materials snap never computed (those rows are missing).
 * Plants are baked into FIFO — must match exactly; empty on both is fine.
 */
export function canPostFilterMb51Agg(
  snap: Mb51AgingReportParams,
  next: Mb51AgingReportParams
): boolean {
  if (
    next.basis !== snap.basis ||
    next.from !== snap.from ||
    next.to !== snap.to ||
    next.groupBy !== snap.groupBy
  ) {
    return false;
  }
  if (!sameSorted(next.plants, snap.plants)) return false;

  const nextEx = new Set(next.excludedMaterials);
  for (const m of snap.excludedMaterials) {
    if (!nextEx.has(m)) return false;
  }

  const gb = next.groupBy;
  if (next.vendors.length && gb !== 'vendor' && gb !== 'vm') return false;
  if (next.materials.length && gb !== 'mat' && gb !== 'vm') return false;
  if (next.groups.length && gb !== 'group' && gb !== 'vm' && gb !== 'mat') return false;
  return true;
}
