import { withAppClient } from '@/lib/read-model/db';
import {
  createBranchRecipientStore,
  listBranchOptionsForRecipients,
  type BranchRecipient,
} from '@/modules/mis-email/server/sync/branch-recipient-store';

const store = createBranchRecipientStore({
  table: 'cancelled_call_digest_recipients',
  uniqueIndex: 'uq_cancelled_call_digest_recipients_branch_email',
  branchIndex: 'idx_cancelled_call_digest_recipients_branch',
});

export type CancelledCallDigestRecipient = BranchRecipient;

let sendLogEnsured = false;

export { listBranchOptionsForRecipients };

export async function ensureCancelledCallDigestTables(): Promise<void> {
  await store.ensureTable();
  if (sendLogEnsured) return;
  await withAppClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.cancelled_call_digest_send_log (
        branch text NOT NULL,
        digest_date date NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        row_count integer NOT NULL DEFAULT 0,
        message_id text,
        PRIMARY KEY (branch, digest_date)
      );
    `);
  });
  sendLogEnsured = true;
}

export const listCancelledCallDigestRecipients = store.list;
export const getCancelledCallDigestRecipient = store.get;
export const createCancelledCallDigestRecipient = store.create;
export const updateCancelledCallDigestRecipient = store.update;
export const deleteCancelledCallDigestRecipient = store.remove;

export async function listEnabledCancelledDigestEmailsForBranch(
  branch: string
): Promise<Array<{ name: string; email: string }>> {
  await ensureCancelledCallDigestTables();
  return store.listEnabledForBranch(branch);
}

export async function wasCancelledDigestAlreadySent(
  branch: string,
  digestDateYmd: string
): Promise<boolean> {
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    const res = await client.query(
      `SELECT 1 FROM public.cancelled_call_digest_send_log
       WHERE upper(btrim(branch)) = upper(btrim($1))
         AND digest_date = $2::date
       LIMIT 1`,
      [branch, digestDateYmd]
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function recordCancelledDigestSent(params: {
  branch: string;
  digestDateYmd: string;
  rowCount: number;
  messageId: string;
}): Promise<void> {
  await ensureCancelledCallDigestTables();
  await withAppClient(async (client) => {
    await client.query(
      `INSERT INTO public.cancelled_call_digest_send_log
         (branch, digest_date, row_count, message_id)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (branch, digest_date) DO NOTHING`,
      [params.branch, params.digestDateYmd, params.rowCount, params.messageId]
    );
  });
}
