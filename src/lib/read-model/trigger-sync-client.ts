import axios from 'axios';
import type { ReadModelProgress, SyncMeta } from '@/lib/read-model/sync-meta';

export type IncrementalSyncApiResult = {
  ok: boolean;
  skipped?: boolean;
  coalesced?: boolean;
  reason?: string;
  rowsUpserted?: number;
  rowsDeleted?: number;
  crmRowsFetched?: number;
  syncMeta?: SyncMeta;
  error?: string;
};

const SYNC_POST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_READ_MODEL_SYNC_TIMEOUT_MS ?? 600_000);
const STATUS_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_READ_MODEL_STATUS_TIMEOUT_MS ?? 90_000);
const SYNC_POLL_MS = 5000;
const STALE_WAIT_HINT_MS = 30_000;
const SYNC_WAIT_MAX_MS = Number(process.env.NEXT_PUBLIC_READ_MODEL_SYNC_WAIT_MS ?? 600_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCallsHotSyncRunning(progress: ReadModelProgress): boolean {
  const hot = progress.syncState.find((row) => row.entity === 'calls_latest_hot');
  return hot?.isRunning === true;
}

export async function fetchReadModelStatus(
  accessToken: string | undefined
): Promise<ReadModelProgress> {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await axios.get<ReadModelProgress>('/api/read-model/status', {
    headers,
    timeout: STATUS_TIMEOUT_MS,
  });
  return res.data;
}

/** Wait until daemon/API is not holding sync_state.is_running (avoids connection pile-up). */
export async function waitForReadModelSyncIdle(
  accessToken: string | undefined,
  maxMs = SYNC_WAIT_MAX_MS,
  onWaiting?: (elapsedMs: number) => void
): Promise<boolean> {
  const started = Date.now();
  const deadline = started + maxMs;
  while (Date.now() < deadline) {
    const elapsedMs = Date.now() - started;
    if (onWaiting && elapsedMs >= STALE_WAIT_HINT_MS) {
      onWaiting(elapsedMs);
    }
    const progress = await fetchReadModelStatus(accessToken);
    if (!isCallsHotSyncRunning(progress)) return true;
    await sleep(SYNC_POLL_MS);
  }
  return false;
}

/** UI sync: CRM incremental ingest into Postgres, then caller reloads from Supabase. */
export async function postIncrementalSyncFromUi(
  accessToken: string | undefined
): Promise<IncrementalSyncApiResult> {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await axios.post<IncrementalSyncApiResult>('/api/read-model/sync', null, {
    headers,
    timeout: SYNC_POST_TIMEOUT_MS,
  });
  return res.data;
}

export function formatIncrementalSyncToast(result: IncrementalSyncApiResult): {
  kind: 'success' | 'info' | 'error';
  message: string;
} {
  if (result.error) {
    return { kind: 'error', message: result.error };
  }
  if (result.skipped && result.reason) {
    return { kind: 'info', message: `Sync skipped: ${result.reason}` };
  }
  const upserted = result.rowsUpserted ?? 0;
  const deleted = result.rowsDeleted ?? 0;
  const fetched = result.crmRowsFetched ?? 0;
  if (upserted > 0 || deleted > 0) {
    const parts: string[] = [];
    if (fetched > 0) parts.push(`${fetched} from CRM`);
    if (upserted > 0) parts.push(`${upserted} updated in database`);
    if (deleted > 0) parts.push(`${deleted} removed`);
    return {
      kind: 'success',
      message: `Synced ${parts.join(', ')} — report reloaded`,
    };
  }
  if (result.coalesced) {
    return {
      kind: 'info',
      message: 'Background sync finished — report reloaded from database',
    };
  }
  return {
    kind: 'info',
    message: 'No new CRM changes — report reloaded from database',
  };
}
