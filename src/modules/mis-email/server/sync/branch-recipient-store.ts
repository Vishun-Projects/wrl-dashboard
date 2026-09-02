import { withAppClient } from '@/lib/read-model/db';
import { assertAllowedEmailDomains } from '@/lib/mail/allowed-domains';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import {
  BRANCH_RECIPIENT_EMAIL_RE,
  normalizeBranchKey,
  normalizeRecipientEmail,
} from '@/modules/mis-email/server/sync/branch-recipient-utils';

export type BranchRecipient = {
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

export type BranchRecipientTableConfig = {
  table: string;
  uniqueIndex: string;
  branchIndex: string;
};

function rowToRecipient(row: RecipientRow): BranchRecipient {
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
  if (!email || !BRANCH_RECIPIENT_EMAIL_RE.test(email)) throw new Error('Valid email is required');
  return { branch, recipientName, email };
}

function isDuplicateKeyError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505');
}

export function createBranchRecipientStore(config: BranchRecipientTableConfig) {
  let ensured = false;
  const { table, uniqueIndex, branchIndex } = config;

  async function ensureTable(): Promise<void> {
    if (ensured) return;
    await withAppClient(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.${table} (
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
        CREATE UNIQUE INDEX IF NOT EXISTS ${uniqueIndex}
        ON public.${table} (lower(btrim(branch)), lower(btrim(email)));
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${branchIndex}
        ON public.${table} (lower(btrim(branch)))
        WHERE enabled = true;
      `);
    });
    ensured = true;
  }

  async function list(): Promise<BranchRecipient[]> {
    await ensureTable();
    return withAppClient(async (client) => {
      const res = await client.query<RecipientRow>(
        `SELECT id, branch, recipient_name, email, enabled, created_at, updated_at
         FROM public.${table}
         ORDER BY upper(btrim(branch)), upper(btrim(recipient_name)), lower(btrim(email))`
      );
      return res.rows.map(rowToRecipient);
    });
  }

  async function get(idRaw: string): Promise<BranchRecipient | null> {
    const id = String(idRaw ?? '').trim();
    if (!id) return null;
    await ensureTable();
    return withAppClient(async (client) => {
      const res = await client.query<RecipientRow>(
        `SELECT id, branch, recipient_name, email, enabled, created_at, updated_at
         FROM public.${table}
         WHERE id = $1::uuid
         LIMIT 1`,
        [id]
      );
      const row = res.rows[0];
      return row ? rowToRecipient(row) : null;
    });
  }

  async function listEnabledForBranch(branch: string): Promise<Array<{ name: string; email: string }>> {
    const key = normalizeBranchKey(branch);
    if (!key) return [];
    await ensureTable();
    return withAppClient(async (client) => {
      const res = await client.query<{ recipient_name: string; email: string }>(
        `SELECT recipient_name, email
         FROM public.${table}
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

  async function create(input: {
    branch: string;
    recipientName: string;
    email: string;
    enabled?: boolean;
  }): Promise<BranchRecipient> {
    const { branch, recipientName, email } = validateInput(input);
    const org = await getMisEmailOrgSettings();
    assertAllowedEmailDomains([email], org.allowedEmailDomains);
    const enabled = input.enabled === true;
    await ensureTable();
    return withAppClient(async (client) => {
      try {
        const res = await client.query<RecipientRow>(
          `INSERT INTO public.${table}
             (branch, recipient_name, email, enabled)
           VALUES ($1, $2, $3, $4)
           RETURNING id, branch, recipient_name, email, enabled, created_at, updated_at`,
          [branch, recipientName, email, enabled]
        );
        const row = res.rows[0];
        if (!row) throw new Error('Insert failed');
        return rowToRecipient(row);
      } catch (err: unknown) {
        if (isDuplicateKeyError(err)) {
          throw new Error('That email is already listed for this branch');
        }
        throw err;
      }
    });
  }

  async function update(input: {
    id: string;
    branch: string;
    recipientName: string;
    email: string;
    enabled: boolean;
  }): Promise<BranchRecipient> {
    const id = String(input.id ?? '').trim();
    if (!id) throw new Error('id is required');
    const { branch, recipientName, email } = validateInput(input);
    const org = await getMisEmailOrgSettings();
    assertAllowedEmailDomains([email], org.allowedEmailDomains);
    await ensureTable();
    return withAppClient(async (client) => {
      try {
        const res = await client.query<RecipientRow>(
          `UPDATE public.${table}
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
        if (isDuplicateKeyError(err)) {
          throw new Error('That email is already listed for this branch');
        }
        throw err;
      }
    });
  }

  async function remove(idRaw: string): Promise<void> {
    const id = String(idRaw ?? '').trim();
    if (!id) throw new Error('id is required');
    await ensureTable();
    await withAppClient(async (client) => {
      const res = await client.query(`DELETE FROM public.${table} WHERE id = $1::uuid`, [id]);
      if (res.rowCount === 0) throw new Error('Recipient not found');
    });
  }

  return {
    ensureTable,
    list,
    get,
    listEnabledForBranch,
    create,
    update,
    remove,
  };
}

export async function listBranchOptionsForRecipients(): Promise<string[]> {
  return withAppClient(async (client) => {
    const res = await client.query<{ vcompanyname: string | null }>(
      `SELECT DISTINCT vcompanyname
       FROM public.dim_offices
       WHERE coalesce(btrim(vcompanyname), '') <> ''
       ORDER BY vcompanyname ASC`
    );
    return res.rows.map((r) => String(r.vcompanyname ?? '').trim()).filter(Boolean);
  });
}
