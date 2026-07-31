import { createHash } from 'crypto';
import { prisma } from '@/lib/db/prisma';

export type PortalAuditPayload = {
  flagsByCallId: Record<string, string>;
  commentCountsByCallId: Record<string, number>;
  loadedAt: number;
  version: number;
};

const TTL_MS = 5 * 60 * 1000;

let serverCache: PortalAuditPayload | null = null;
let cacheVersion = 0;

export function clearPortalAuditServerCache(): void {
  serverCache = null;
  cacheVersion += 1;
}

export function portalAuditEtag(payload: PortalAuditPayload): string {
  return `"${createHash('sha256').update(`${payload.version}:${payload.loadedAt}`).digest('hex').slice(0, 16)}"`;
}

export async function getPortalAuditPayload(options?: {
  officeIds?: string[];
}): Promise<PortalAuditPayload> {
  if (serverCache && Date.now() - serverCache.loadedAt < TTL_MS && !options?.officeIds?.length) {
    return serverCache;
  }

  const officeIds = options?.officeIds?.filter(Boolean) ?? [];
  const hasOfficeFilter = officeIds.length > 0;

  const [flagsRows, commentCountRows] = await Promise.all([
    hasOfficeFilter
      ? prisma.$queryRawUnsafe<Array<{ call_id: string; flag_type: string }>>(
          `SELECT call_id, flag_type FROM call_flags WHERE office_id = ANY($1::text[])`,
          officeIds
        )
      : prisma.$queryRawUnsafe<Array<{ call_id: string; flag_type: string }>>(
          `SELECT call_id, flag_type FROM call_flags`
        ),
    hasOfficeFilter
      ? prisma.$queryRawUnsafe<Array<{ call_id: string; cnt: number }>>(
          `SELECT call_id, count(*)::int AS cnt FROM call_comments WHERE office_id = ANY($1::text[]) GROUP BY call_id`,
          officeIds
        )
      : prisma.$queryRawUnsafe<Array<{ call_id: string; cnt: number }>>(
          `SELECT call_id, count(*)::int AS cnt FROM call_comments GROUP BY call_id`
        ),
  ]);

  const flagsByCallId: Record<string, string> = {};
  for (const row of flagsRows) {
    if (row.call_id != null && row.flag_type) {
      flagsByCallId[String(row.call_id)] = String(row.flag_type);
    }
  }

  const commentCountsByCallId: Record<string, number> = {};
  for (const row of commentCountRows) {
    if (row.call_id == null) continue;
    commentCountsByCallId[String(row.call_id)] = row.cnt;
  }

  serverCache = {
    flagsByCallId,
    commentCountsByCallId,
    loadedAt: Date.now(),
    version: cacheVersion,
  };
  if (!hasOfficeFilter) {
    return serverCache;
  }

  return {
    flagsByCallId,
    commentCountsByCallId,
    loadedAt: Date.now(),
    version: cacheVersion,
  };
}
