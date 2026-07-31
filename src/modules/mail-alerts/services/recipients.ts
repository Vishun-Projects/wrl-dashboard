import { withAppClient } from '@/lib/read-model/db';
import {
  expandPermissionList,
  hasMisEmailSendAccess,
  resolveMisEmailReportIncludes,
} from '@/lib/auth/rbac-catalog';
import { USER_ASSIGNED_ROLES_LATERAL } from '@/lib/auth/user-roles-sql';
import {
  hasAnyEffectiveDigestInclude,
  isMisEmailSubscribed,
  parseMisEmailPreferences,
  resolveEffectiveDigestIncludes,
  type MisEmailPreferences,
} from '@/modules/mail-alerts/services/preferences';

export type DigestRecipient = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[];
  visible_statuses: string[];
  permissions: string[];
  includeSummary: boolean;
  includeDetailed: boolean;
  includeKeyAccount: boolean;
  mis_email_enabled: boolean;
  mis_email_preferences: MisEmailPreferences;
};

type RecipientRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  office_ids: string[] | null;
  visible_statuses: string[] | null;
  permission_names: string[] | null;
  mis_email_enabled: boolean;
  mis_email_preferences: unknown;
};

const RECIPIENT_SELECT = `SELECT u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses,
  u.mis_email_enabled, u.mis_email_preferences,
  COALESCE(array_agg(DISTINCT ap.name) FILTER (WHERE ap.name IS NOT NULL), '{}') AS permission_names`;

const RECIPIENT_FROM = `FROM public.app_users u
       ${USER_ASSIGNED_ROLES_LATERAL}
       LEFT JOIN public.app_role_permissions arp ON arp.role_id = assigned.role_id
       LEFT JOIN public.app_permissions ap ON ap.id = arp.permission_id`;

const RECIPIENT_GROUP_BY = `GROUP BY u.id, u.name, u.email, u.role, u.office_ids, u.visible_statuses,
  u.mis_email_enabled, u.mis_email_preferences`;

export function passesDigestRecipientFilters(
  recipient: DigestRecipient | null
): recipient is DigestRecipient {
  if (!recipient) return false;
  if (!recipient.mis_email_enabled) return false;
  if (!hasMisEmailSendAccess(recipient.permissions)) return false;
  if (!isMisEmailSubscribed(recipient.mis_email_preferences)) return false;
  const effective = resolveEffectiveDigestIncludes(recipient, recipient.mis_email_preferences);
  return hasAnyEffectiveDigestInclude(effective);
}

export async function loadDigestRecipients(): Promise<DigestRecipient[]> {
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `${RECIPIENT_SELECT}
       ${RECIPIENT_FROM}
       WHERE u.email IS NOT NULL AND btrim(u.email) <> ''
         AND u.mis_email_enabled = true
       ${RECIPIENT_GROUP_BY}
       ORDER BY u.email ASC`
    );

    const recipients: DigestRecipient[] = [];

    for (const row of res.rows) {
      const recipient = rowToDigestRecipient(row);
      if (passesDigestRecipientFilters(recipient)) {
        recipients.push(recipient);
      }
    }

    return recipients;
  });
}

export async function loadDigestRecipientById(userId: string): Promise<DigestRecipient | null> {
  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `${RECIPIENT_SELECT}
       ${RECIPIENT_FROM}
       WHERE u.id = $1
       ${RECIPIENT_GROUP_BY}
       LIMIT 1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return rowToDigestRecipient(row);
  });
}

function rowToDigestRecipient(row: RecipientRow): DigestRecipient {
  const permissions = expandPermissionList(row.permission_names ?? []);
  const { includeSummary, includeDetailed, includeKeyAccount } =
    resolveMisEmailReportIncludes(permissions);

  return {
    id: row.id,
    name: row.name,
    email: row.email.trim(),
    role: row.role,
    office_ids: row.office_ids ?? [],
    visible_statuses: row.visible_statuses ?? [],
    permissions,
    includeSummary,
    includeDetailed,
    includeKeyAccount,
    mis_email_enabled: row.mis_email_enabled ?? false,
    mis_email_preferences: parseMisEmailPreferences(row.mis_email_preferences),
  };
}

/** Match digest-eligible app_users by email (case-insensitive). */
export async function loadDigestRecipientByEmail(email: string): Promise<DigestRecipient | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  return withAppClient(async (client) => {
    const res = await client.query<RecipientRow>(
      `${RECIPIENT_SELECT}
       ${RECIPIENT_FROM}
       WHERE lower(btrim(u.email)) = $1
       ${RECIPIENT_GROUP_BY}
       LIMIT 1`,
      [normalized]
    );
    const row = res.rows[0];
    if (!row) return null;
    return rowToDigestRecipient(row);
  });
}

/** Any app_users row by email — for greeting when user is not digest-eligible. */
export async function loadAppUserProfileByEmail(
  email: string
): Promise<{ id: string; name: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  return withAppClient(async (client) => {
    const res = await client.query<{ id: string; name: string; email: string }>(
      `SELECT id, name, email
       FROM public.app_users
       WHERE lower(btrim(email)) = $1
       LIMIT 1`,
      [normalized]
    );
    const row = res.rows[0];
    if (!row) return null;
    return { id: row.id, name: row.name, email: row.email.trim() };
  });
}
