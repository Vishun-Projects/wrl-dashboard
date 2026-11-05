/**
 * Browser cache for Warranty Provision report payloads (SPA + session reloads).
 * Cleared on units import.
 */

import type {
  ActiveUnitsResponse,
  BreakdownMfgResponse,
  SnapResponse,
  WarrantyAssumptions,
  WarrantyClaimRow,
  WarrantyForecastResponse,
  WarrantyProvisionOptions,
  WarrantyProvisionRowsResponse,
  WarrantyRatesResponse,
} from '@/modules/warranty-provision/types';

const TTL_MS = 30 * 60 * 1000;
const SS_PREFIX = 'wp-cache:';

type Entry<T> = { at: number; data: T };

const mem = new Map<string, Entry<unknown>>();

function readSs<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed?.at || Date.now() - parsed.at > TTL_MS) {
      sessionStorage.removeItem(SS_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeSs<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(SS_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota / private mode */
  }
}

export function cacheGet<T>(key: string): T | null {
  const hit = mem.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at <= TTL_MS) return hit.data;
  const ss = readSs<T>(key);
  if (ss) {
    mem.set(key, { at: Date.now(), data: ss });
    return ss;
  }
  return null;
}

export function cacheSet<T>(key: string, data: T): void {
  mem.set(key, { at: Date.now(), data });
  writeSs(key, data);
}

export function cacheClearWarranty(): void {
  mem.clear();
  try {
    const remove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SS_PREFIX)) remove.push(k);
    }
    for (const k of remove) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export type SnapBundle = {
  snap: SnapResponse;
  active: ActiveUnitsResponse | null;
  breakdown: BreakdownMfgResponse | null;
  breakdownWco: BreakdownMfgResponse | null;
};

export function snapCacheKey(qs: string, asOf: string, periodYm: string): string {
  return `snap:${qs}|active:${asOf}|bd:${periodYm}|wco`;
}

export function unitsCacheKey(qs: string): string {
  return `units:${qs}`;
}

export function claimsCacheKey(
  periodYm: string,
  q: string,
  page = 1,
  pageSize = 50
): string {
  return `claims:${periodYm}|q:${q.trim().toLowerCase()}|p:${page}|ps:${pageSize}`;
}

export function ratesCacheKey(qs: string): string {
  return `rates:${qs}`;
}

export function forecastCacheKey(qs: string, scenario: string): string {
  return `forecast:${qs}|${scenario}`;
}

export function mismatchCacheKey(
  periodYm: string,
  onlyIn: string,
  page: number,
  pageSize: number
): string {
  return `mismatch:${periodYm}|${onlyIn || 'all'}|p:${page}|ps:${pageSize}`;
}

export type ClaimsCachePayload = {
  rows: WarrantyClaimRow[];
  total: number;
  meta?: { syncedAt: string | null; rowCount: number; syncedBy: string };
};

export type {
  WarrantyAssumptions,
  WarrantyForecastResponse,
  WarrantyProvisionOptions,
  WarrantyProvisionRowsResponse,
  WarrantyRatesResponse,
};
