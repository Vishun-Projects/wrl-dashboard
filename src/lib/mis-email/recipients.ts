import { withAppClient } from '@/lib/read-model/db';
import { expandPermissionList } from '@/lib/auth/rbac-catalog';

export type DigestRecipient = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[];
  permissions: string[];
  includeSummary: boolean;
  includeKeyAccount: boolean;
};

type RecipientRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[] | null;
  permission_names: string[] | null;
};

export async function loadDigestRecipients(): Promise<DigestRecipient[]> {
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `SELECT u.id, u.name, u.email, u.role, u.office_ids,
              COALESCE(array_agg(DISTINCT ap.name) FILTER (WHERE ap.name IS NOT NULL), '{}') AS permission_names
       FROM public.app_users u
       LEFT JOIN public.app_role_permissions arp ON arp.role_id = u.role_id
       LEFT JOIN public.app_permissions ap ON ap.id = arp.permission_id
       WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
       GROUP BY u.id, u.name, u.email, u.role, u.office_ids
       ORDER BY u.email ASC`
    );

    const recipients: DigestRecipient[] = [];

    for (const row of res.rows) {
      const permissions = expandPermissionList(row.permission_names ?? []);
      const includeSummary = permissions.includes('tab_mis_summary');
      const includeKeyAccount = permissions.includes('tab_mis_accounts');
      if (!includeSummary && !includeKeyAccount) continue;

      recipients.push({
        id: row.id,
        name: row.name,
        email: row.email.trim(),
        role: row.role,
        office_ids: row.office_ids ?? [],
        permissions,
        includeSummary,
        includeKeyAccount,
      });
    }

    return recipients;
  });
}

export async function loadDigestRecipientById(userId: string): Promise<DigestRecipient | null> {
  const all = await loadDigestRecipients();
  return all.find((r) => r.id === userId) ?? null;
}
