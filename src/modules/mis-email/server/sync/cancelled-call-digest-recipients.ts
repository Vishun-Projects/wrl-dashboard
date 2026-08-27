import { withAppClient } from '@/lib/read-model/db';
import { assertAllowedEmailDomains } from '@/lib/mail/allowed-domains';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings-lib';
import {
  listBranchOptionsForRecipients,
  normalizeBranchKey,
  normalizeRecipientEmail,
} from '@/modules/mis-email/server/sync/major-repair-repeat-recipients';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CancelledCallDigestRecipient = {
  id: string;
  branch: string;
  recipientName: string;
  email: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type RecipientRow = {
  id: string;
  branch: string;
  recipient_name: string;
  email: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

let ensured = false;

function rowToRecipient(row: RecipientRow): CancelledCallDigestRecipient {
  return {
    id: row.id,
    branch: String(row.branch ?? '').trim(),
    recipientName: String(row.recipient_name ?? '').trim(),
    email: normalizeRecipientEmail(String(row.email ?? '')),
    enabled: row.enabled === true,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function ensureCancelledCallDigestTables(): Promise<void> {
  if (ensured) return;
  await withAppClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.cancelled_call_digest_recipients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        branch text NOT NULL,
        recipient_name text NOT NULL,
        email text NOT NULL,
        enabled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_cancelled_call_digest_recipients_branch_email
      ON public.cancelled_call_digest_recipients (lower(btrim(branch)), lower(btrim(email)));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cancelled_call_digest_recipients_branch
      ON public.cancelled_call_digest_recipients (lower(btrim(branch)))
      WHERE enabled = true;
    `);
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
  ensured = true;
}

export { listBranchOptionsForRecipients };

export async function listCancelledCallDigestRecipients(): Promise<
  CancelledCallDigestRecipient[]
> {
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `SELECT id, branch, recipient_name, email, enabled, created_at, updated_at
       FROM public.cancelled_call_digest_recipients
       ORDER BY upper(btrim(branch)), upper(btrim(recipient_name)), lower(btrim(email))`
    );
    return res.rows.map(rowToRecipient);
  });
}

export async function getCancelledCallDigestRecipient(
  idRaw: string
): Promise<CancelledCallDigestRecipient | null> {
  const id = String(idRaw ?? '').trim();
  if (!id) return null;
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `SELECT id, branch, recipient_name, email, enabled, created_at, updated_at
       FROM public.cancelled_call_digest_recipients
       WHERE id = $1::uuid
       LIMIT 1`,
      [id]
    );
    const row = res.rows[0];
    return row ? rowToRecipient(row) : null;
  });
}

export async function listEnabledCancelledDigestEmailsForBranch(
  branch: string
): Promise<Array<{ name: string; email: string }>> {
  const key = normalizeBranchKey(branch);
  if (!key) return [];
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    const res = await client.query<{ recipient_name: string; email: string }>(
      `SELECT recipient_name, email
       FROM public.cancelled_call_digest_recipients
       WHERE enabled = true
         AND upper(btrim(branch)) = $1
       ORDER BY upper(btrim(recipient_name)), lower(btrim(email))`,
      [key]
    );
    return res.rows
      .map((r) => ({
        name: String(r.recipient_name ?? '').trim(),
        email: normalizeRecipientEmail(String(r.email ?? '')),
      }))
      .filter((r) => r.email);
  });
}

function validateInput(input: {
  branch: string;
  recipientName: string;
  email: string;
}): { branch: string; recipientName: string; email: string } {
  const branch = String(input.branch ?? '').trim().replace(/\s+/g, ' ');
  const recipientName = String(input.recipientName ?? '').trim().replace(/\s+/g, ' ');
  const email = normalizeRecipientEmail(String(input.email ?? ''));
  if (!branch) throw new Error('Branch is required');
  if (!recipientName) throw new Error('Recipient name is required');
  if (!email || !EMAIL_RE.test(email)) throw new Error('Valid email is required');
  return { branch, recipientName, email };
}

export async function createCancelledCallDigestRecipient(input: {
  branch: string;
  recipientName: string;
  email: string;
  enabled?: boolean;
}): Promise<CancelledCallDigestRecipient> {
  const { branch, recipientName, email } = validateInput(input);
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([email], org.allowedEmailDomains);
  const enabled = input.enabled === true;
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    try {
      const res = await client.query<RecipientRow>(
        `INSERT INTO public.cancelled_call_digest_recipients
           (branch, recipient_name, email, enabled)
         VALUES ($1, $2, $3, $4)
         RETURNING id, branch, recipient_name, email, enabled, created_at, updated_at`,
        [branch, recipientName, email, enabled]
      );
      const row = res.rows[0];
      if (!row) throw new Error('Insert failed');
      return rowToRecipient(row);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        throw new Error('That email is already listed for this branch');
      }
      throw err;
    }
  });
}

export async function updateCancelledCallDigestRecipient(input: {
  id: string;
  branch: string;
  recipientName: string;
  email: string;
  enabled: boolean;
}): Promise<CancelledCallDigestRecipient> {
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('id is required');
  const { branch, recipientName, email } = validateInput(input);
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([email], org.allowedEmailDomains);
  await ensureCancelledCallDigestTables();
  return withAppClient(async (client) => {
    try {
      const res = await client.query<RecipientRow>(
        `UPDATE public.cancelled_call_digest_recipients
         SET branch = $2,
             recipient_name = $3,
             email = $4,
             enabled = $5,
             updated_at = now()
         WHERE id = $1::uuid
         RETURNING id, branch, recipient_name, email, enabled, created_at, updated_at`,
        [id, branch, recipientName, email, input.enabled === true]
      );
      const row = res.rows[0];
      if (!row) throw new Error('Recipient not found');
      return rowToRecipient(row);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        throw new Error('That email is already listed for this branch');
      }
      throw err;
    }
  });
}

export async function deleteCancelledCallDigestRecipient(idRaw: string): Promise<void> {
  const id = String(idRaw ?? '').trim();
  if (!id) throw new Error('id is required');
  await ensureCancelledCallDigestTables();
  await withAppClient(async (client) => {
    const res = await client.query(
      `DELETE FROM public.cancelled_call_digest_recipients WHERE id = $1::uuid`,
      [id]
    );
    if (res.rowCount === 0) throw new Error('Recipient not found');
  });
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
