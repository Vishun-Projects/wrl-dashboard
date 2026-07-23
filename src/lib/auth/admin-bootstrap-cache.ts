/** Shared admin bootstrap response cache (cleared on user/role writes). */
const BOOTSTRAP_CACHE_TTL_MS = 15_000;

type BootstrapPayload = {
  users: unknown;
  roles: unknown;
  me: unknown;
  pagination: unknown;
};

const bootstrapCache = new Map<string, { expiresAt: number; payload: BootstrapPayload }>();

export function getAdminBootstrapCache(
  key: string
): BootstrapPayload | null {
  const cached = bootstrapCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    bootstrapCache.delete(key);
    return null;
  }
  return cached.payload;
}

export function setAdminBootstrapCache(key: string, payload: BootstrapPayload): void {
  bootstrapCache.set(key, { payload, expiresAt: Date.now() + BOOTSTRAP_CACHE_TTL_MS });
}

export function clearAdminBootstrapCache(): void {
  bootstrapCache.clear();
}
