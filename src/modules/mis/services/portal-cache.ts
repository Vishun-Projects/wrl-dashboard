const SESSION_CACHE_KEY = 'portal-audit-cache-v1';

export type PortalAuditCache = {
  flagsByCallId: Map<string, string>;
  commentCountsByCallId: Map<string, number>;
  loadedAt: number;
};

type PortalAuditSessionEntry = {
  flagsByCallId: Record<string, string>;
  commentCountsByCallId: Record<string, number>;
  loadedAt: number;
  etag?: string;
};

let portalAuditCache: PortalAuditCache | null = null;
let portalLoadInflight: Promise<PortalAuditCache> | null = null;

function mapsFromPayload(payload: PortalAuditSessionEntry): PortalAuditCache {
  return {
    flagsByCallId: new Map(Object.entries(payload.flagsByCallId)),
    commentCountsByCallId: new Map(Object.entries(payload.commentCountsByCallId)),
    loadedAt: payload.loadedAt,
  };
}

function readSessionCache(): PortalAuditSessionEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortalAuditSessionEntry;
    if (
      !parsed.flagsByCallId ||
      !parsed.commentCountsByCallId ||
      typeof parsed.loadedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(payload: PortalAuditSessionEntry): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota exceeded — skip */
  }
}

export function getPortalAuditCache(): PortalAuditCache | null {
  return portalAuditCache;
}

export function clearPortalAuditCache(): void {
  portalAuditCache = null;
  portalLoadInflight = null;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(SESSION_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export async function ensurePortalAuditCache(
  authHeaders?: Record<string, string>
): Promise<PortalAuditCache> {
  if (portalAuditCache) return portalAuditCache;

  const sessionEntry = readSessionCache();
  if (sessionEntry && !authHeaders) {
    portalAuditCache = mapsFromPayload(sessionEntry);
  }

  if (portalLoadInflight) return portalLoadInflight;

  portalLoadInflight = (async () => {
    const headers: Record<string, string> = { ...authHeaders };
    const cached = readSessionCache();
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    const res = await fetch('/api/report/portal-audit', {
      headers,
      credentials: 'include',
    });

    if (res.status === 304 && cached) {
      portalAuditCache = mapsFromPayload(cached);
      return portalAuditCache;
    }

    if (!res.ok) {
      if (cached) {
        portalAuditCache = mapsFromPayload(cached);
        return portalAuditCache;
      }
      throw new Error(`Portal audit fetch failed (${res.status})`);
    }

    const body = (await res.json()) as Omit<PortalAuditSessionEntry, 'etag'>;
    const entry: PortalAuditSessionEntry = {
      ...body,
      etag: res.headers.get('ETag') ?? undefined,
    };
    writeSessionCache(entry);
    portalAuditCache = mapsFromPayload(entry);
    return portalAuditCache;
  })();

  try {
    return await portalLoadInflight;
  } finally {
    portalLoadInflight = null;
  }
}

const FLAGGED_TYPES = new Set(['noted', 'escalate', 'query']);

export function matchesPortalFilter(
  row: Record<string, unknown>,
  portalFilter: string[],
  cache: PortalAuditCache | null
): boolean {
  if (portalFilter.length === 0) return true;
  if (!cache) return true;

  const callId = String(row.id ?? row.ncode ?? '');
  const flag = callId ? cache.flagsByCallId.get(callId) : undefined;
  const commentCount = callId ? cache.commentCountsByCallId.get(callId) ?? 0 : 0;

  return portalFilter.some((filter) => {
    switch (filter) {
      case 'verified':
        return flag === 'noted';
      case 'rejected':
        return flag === 'escalate';
      case 'hold':
        return flag === 'query';
      case 'comments':
        return commentCount > 0;
      case 'unseen':
        return !flag || !FLAGGED_TYPES.has(flag);
      default:
        return false;
    }
  });
}
