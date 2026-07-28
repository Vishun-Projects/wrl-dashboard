import { withAppClient } from '@/lib/read-model/db';
import { assertAllowedEmailDomains } from '@/lib/mail/allowed-domains';
import { getMisEmailOrgSettings } from '@/lib/org-settings/mis-email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MajorRepairRepeatRecipient = {
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

export function normalizeBranchKey(branch: string): string {
  return branch.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToRecipient(row: RecipientRow): MajorRepairRepeatRecipient {
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

export async function ensureMajorRepairRepeatRecipientsTable(): Promise<void> {
  if (ensured) return;
  await withAppClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.major_repair_repeat_recipients (
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
      CREATE UNIQUE INDEX IF NOT EXISTS uq_major_repair_repeat_recipients_branch_email
      ON public.major_repair_repeat_recipients (lower(btrim(branch)), lower(btrim(email)));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_major_repair_repeat_recipients_branch
      ON public.major_repair_repeat_recipients (lower(btrim(branch)))
      WHERE enabled = true;
    `);
  });
  ensured = true;
}

export async function listMajorRepairRepeatRecipients(): Promise<MajorRepairRepeatRecipient[]> {
  await ensureMajorRepairRepeatRecipientsTable();
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `SELECT id, branch, recipient_name, email, enabled, created_at, updated_at
       FROM public.major_repair_repeat_recipients
       ORDER BY upper(btrim(branch)), upper(btrim(recipient_name)), lower(btrim(email))`
    );
    return res.rows.map(rowToRecipient);
  });
}

export async function listBranchOptionsForRecipients(): Promise<string[]> {
  return withAppClient(async (client) => {
    const res = await client.query<{ vcompanyname: string | null }>(
      `SELECT DISTINCT vcompanyname
       FROM public.dim_offices
       WHERE coalesce(btrim(vcompanyname), '') <> ''
       ORDER BY vcompanyname ASC`
    );
    return res.rows
      .map((r) => String(r.vcompanyname ?? '').trim())
      .filter(Boolean);
  });
}

export async function listEnabledEmailsForBranch(branch: string): Promise<
  Array<{ name: string; email: string }>
> {
  const key = normalizeBranchKey(branch);
  if (!key) return [];
  await ensureMajorRepairRepeatRecipientsTable();
  return withAppClient(async (client) => {
    const res = await client.query<{ recipient_name: string; email: string }>(
      `SELECT recipient_name, email
       FROM public.major_repair_repeat_recipients
       WHERE enabled = true
         AND upper(btrim(branch)) = $1
       ORDER BY upper(btrim(recipient_name)), lower(btrim(email))`,
      [key]
    );
    return res.rows.map((r) => ({
      name: String(r.recipient_name ?? '').trim(),
      email: normalizeRecipientEmail(String(r.email ?? '')),
    })).filter((r) => r.email);
  });
}

export function resolveAlertRecipients(params: {
  branchEmails: string[];
  hqTo: string;
  hqCc: string;
}): { to: string[]; cc: string[] } {
  const branch = [
    ...new Set(params.branchEmails.map(normalizeRecipientEmail).filter(Boolean)),
  ];
  const hqTo = normalizeRecipientEmail(params.hqTo);
  const hqCc = normalizeRecipientEmail(params.hqCc);
  const hq = [...new Set([hqTo, hqCc].filter(Boolean))];

  if (branch.length > 0) {
    const to = branch;
    const cc = hq.filter((e) => !to.includes(e));
    return { to, cc };
  }
  return {
    to: hqTo ? [hqTo] : [],
    cc: hqCc && hqCc !== hqTo ? [hqCc] : [],
  };
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

export async function createMajorRepairRepeatRecipient(input: {
  branch: string;
  recipientName: string;
  email: string;
  enabled?: boolean;
}): Promise<MajorRepairRepeatRecipient> {
  const { branch, recipientName, email } = validateInput(input);
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([email], org.allowedEmailDomains);
  // Safe default: new rows do not alert until HOD enables.
  const enabled = input.enabled === true;
  await ensureMajorRepairRepeatRecipientsTable();
  return withAppClient(async (client) => {
    try {
      const res = await client.query<RecipientRow>(
        `INSERT INTO public.major_repair_repeat_recipients
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

export async function updateMajorRepairRepeatRecipient(input: {
  id: string;
  branch: string;
  recipientName: string;
  email: string;
  enabled: boolean;
}): Promise<MajorRepairRepeatRecipient> {
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error('id is required');
  const { branch, recipientName, email } = validateInput(input);
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([email], org.allowedEmailDomains);
  await ensureMajorRepairRepeatRecipientsTable();
  return withAppClient(async (client) => {
    try {
      const res = await client.query<RecipientRow>(
        `UPDATE public.major_repair_repeat_recipients
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

export async function deleteMajorRepairRepeatRecipient(idRaw: string): Promise<void> {
  const id = String(idRaw ?? '').trim();
  if (!id) throw new Error('id is required');
  await ensureMajorRepairRepeatRecipientsTable();
  await withAppClient(async (client) => {
    const res = await client.query(
      `DELETE FROM public.major_repair_repeat_recipients WHERE id = $1::uuid`,
      [id]
    );
    if (res.rowCount === 0) throw new Error('Recipient not found');
  });
}
