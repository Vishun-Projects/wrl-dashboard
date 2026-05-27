import { withClient } from '@/lib/read-model/db';
import { purgeOldIngestBatches, purgeOldSyncLogs } from '@/lib/read-model/batches';
import { deleteFactsBeforeYearStart } from '@/lib/read-model/upsert-facts';
import { currentYearStart } from '@/lib/read-model/dates';

export async function runRetentionJobs(): Promise<void> {
  await withClient(async (client) => {
    const logs = await purgeOldSyncLogs(client, 30);
    const batches = await purgeOldIngestBatches(client, 90);
    const facts = await deleteFactsBeforeYearStart(client, currentYearStart());
    console.log(
      `[sync-worker] Retention — removed ${logs} sync logs, ${batches} ingest batches, ${facts} pre-YTD fact rows`
    );
  });
}
