import type { SupabaseClient } from '@supabase/supabase-js';

export type PortalAuditCache = {
  flagsByCallId: Map<string, string>;
  commentCountsByCallId: Map<string, number>;
  loadedAt: number;
};

let portalAuditCache: PortalAuditCache | null = null;
let portalLoadInflight: Promise<PortalAuditCache> | null = null;

export function getPortalAuditCache(): PortalAuditCache | null {
  return portalAuditCache;
}

export function clearPortalAuditCache(): void {
  portalAuditCache = null;
  portalLoadInflight = null;
}

export async function ensurePortalAuditCache(
  supabase: SupabaseClient
): Promise<PortalAuditCache> {
  if (portalAuditCache) return portalAuditCache;
  if (portalLoadInflight) return portalLoadInflight;

  portalLoadInflight = (async () => {
    const [flagsRes, commentsRes] = await Promise.all([
      supabase.from('call_flags').select('call_id, flag_type'),
      supabase.from('call_comments').select('call_id'),
    ]);

    const flagsByCallId = new Map<string, string>();
    for (const row of flagsRes.data || []) {
      if (row.call_id != null && row.flag_type) {
        flagsByCallId.set(String(row.call_id), String(row.flag_type));
      }
    }

    const commentCountsByCallId = new Map<string, number>();
    for (const row of commentsRes.data || []) {
      if (row.call_id == null) continue;
      const id = String(row.call_id);
      commentCountsByCallId.set(id, (commentCountsByCallId.get(id) || 0) + 1);
    }

    portalAuditCache = {
      flagsByCallId,
      commentCountsByCallId,
      loadedAt: Date.now(),
    };
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
