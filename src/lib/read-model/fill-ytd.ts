import { syncHotYtdFromCrm } from '@/lib/read-model/sync-hot-ytd';

/** Upsert YTD + open-old from CRM — no truncate (safe gap-fill after initial backfill). */
export async function runFillYtdHot(): Promise<void> {
  console.log('[sync-worker] fill-ytd — upsert only, no truncate');
  await syncHotYtdFromCrm();
}
