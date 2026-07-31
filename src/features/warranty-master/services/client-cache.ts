import type { WarrantyMasterFgLineRow } from '@/features/warranty-master/services/types';

const CACHE_KEY = 'warranty-master-fg-lines-v1';

export type WarrantyMasterClientCache = {
  totalMachines: number;
  fgLines: WarrantyMasterFgLineRow[];
  cachedAt: string;
};

export function readWarrantyMasterCache(): WarrantyMasterClientCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WarrantyMasterClientCache;
    if (!Array.isArray(parsed.fgLines) || typeof parsed.totalMachines !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeWarrantyMasterCache(
  totalMachines: number,
  fgLines: WarrantyMasterFgLineRow[]
): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: WarrantyMasterClientCache = {
      totalMachines,
      fgLines,
      cachedAt: new Date().toISOString(),
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* quota exceeded — skip cache */
  }
}

export function clearWarrantyMasterCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}
