/** Short TTL cache for /api/auth/me — clear when a user's roles/permissions change. */
type CachedMe = {
  expiresAt: number;
  payload: unknown;
};

const meCache = new Map<string, CachedMe>();
export const ME_CACHE_TTL_MS = 15_000;

export function getMeCache(userId: string): CachedMe | null {
  const cached = meCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    meCache.delete(userId);
    return null;
  }
  return cached;
}

export function setMeCache(userId: string, payload: unknown): void {
  meCache.set(userId, { payload, expiresAt: Date.now() + ME_CACHE_TTL_MS });
}

export function clearMeCache(userId?: string): void {
  if (userId) meCache.delete(userId);
  else meCache.clear();
}
