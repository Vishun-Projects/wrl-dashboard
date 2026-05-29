import { withClient } from '@/lib/read-model/db';
import { getArcpSyncState } from '@/lib/read-model/arcp/lock';
import { countArcpRows } from '@/lib/read-model/arcp/upsert';

export type ArcpReadiness = {
  ready: boolean;
  reason?: string;
  rowCount: number;
  status: string | null;
};

export async function getArcpReadiness(): Promise<ArcpReadiness> {
  return withClient(async (client) => {
    const state = await getArcpSyncState(client);
    const rowCount = await countArcpRows(client);
    const status = state?.status ?? null;

    if (status === 'pending_backfill' && rowCount === 0) {
      return {
        ready: false,
        reason: 'ARCP backfill has not completed — run npm run sync-worker:arcp-backfill',
        rowCount,
        status,
      };
    }

    if (status === 'backfilling' && rowCount === 0) {
      return {
        ready: false,
        reason: 'ARCP backfill in progress — no rows loaded yet',
        rowCount,
        status,
      };
    }

    if (rowCount === 0) {
      return {
        ready: false,
        reason: 'arcp_lines_hot is empty — run npm run sync-worker:arcp-backfill',
        rowCount,
        status,
      };
    }

    return { ready: true, rowCount, status };
  });
}
