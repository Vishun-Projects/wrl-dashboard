import { withAppClient } from '@/lib/read-model/db';
import { assertAllowedEmailDomains } from '@/lib/mail/allowed-domains';
import { normalizeEmailList } from '@/modules/mis-email/services/parse-outlook-emails';
import {
  isMisEmailSubscribed,
  mergeMisEmailPreferences,
  normalizeMisEmailSendTime,
  parseMisEmailPreferences,
  resolveMisEmailCcEmails,
  resolveMisEmailSendTimeIst,
  resolveMisEmailToEmails,
  type MisEmailDateRangeMode,
} from '@/modules/mis-email/services/preferences';

export type MisEmailUserScheduleRow = {
  id: string;
  name: string;
  email: string;
  misEmailEnabled: boolean;
  subscribed: boolean;
  sendTimeIst: string;
  dateRange: MisEmailDateRangeMode;
  toEmails: string[];
  ccEmails: string[];
};

type Row = {
  id: string;
  name: string;
  email: string;
  mis_email_enabled: boolean;
  mis_email_preferences: unknown;
};

function rowToSchedule(row: Row): MisEmailUserScheduleRow {
  const prefs = parseMisEmailPreferences(row.mis_email_preferences);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    misEmailEnabled: Boolean(row.mis_email_enabled),
    subscribed: isMisEmailSubscribed(prefs),
    sendTimeIst: resolveMisEmailSendTimeIst(prefs),
    dateRange: prefs.dateRange ?? 'month_to_date',
    toEmails: resolveMisEmailToEmails(prefs),
    ccEmails: resolveMisEmailCcEmails(prefs),
  };
}

/**
 * Super Admin visibility: anyone with MIS digest admin-enabled, or who saved a send time
 * in Profile → Email reports (even before admin enable).
 */
export async function listMisEmailUserSchedules(): Promise<MisEmailUserScheduleRow[]> {
  return withAppClient(async (client) => {
    const res = await client.query<Row>(
      `SELECT id, name, email, mis_email_enabled, mis_email_preferences
       FROM public.app_users
       WHERE email IS NOT NULL AND btrim(email) <> ''
         AND (
           mis_email_enabled = true
           OR (mis_email_preferences ? 'sendTimeIst')
           OR (mis_email_preferences ? 'subscribed')
         )
       ORDER BY
         COALESCE(mis_email_preferences->>'sendTimeIst', '09:30') ASC,
         lower(email) ASC`
    );
    return res.rows.map(rowToSchedule);
  });
}

export type AdminMisEmailUserPrefsPatch = {
  misEmailEnabled?: boolean;
  subscribed?: boolean;
  sendTimeIst?: string;
  dateRange?: MisEmailDateRangeMode;
  toEmails?: string[];
  ccEmails?: string[];
};

/** Emergency admin update of a user's personal digest prefs (not org copy). */
export async function adminUpdateMisEmailUserPrefs(
  userId: string,
  patch: AdminMisEmailUserPrefsPatch,
  allowedEmailDomains: string[]
): Promise<{ before: MisEmailUserScheduleRow; user: MisEmailUserScheduleRow }> {
  return withAppClient(async (client) => {
    const existing = await client.query<Row>(
      `SELECT id, name, email, mis_email_enabled, mis_email_preferences
       FROM public.app_users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    const row = existing.rows[0];
    if (!row) throw new Error('User not found');
    const before = rowToSchedule(row);

    const current = parseMisEmailPreferences(row.mis_email_preferences);
    const nextPrefs = mergeMisEmailPreferences(current, {});

    if (patch.subscribed !== undefined) nextPrefs.subscribed = patch.subscribed;
    if (patch.sendTimeIst !== undefined) {
      const t = normalizeMisEmailSendTime(patch.sendTimeIst);
      if (!t) throw new Error('Digest time must be in HH:mm format (IST)');
      nextPrefs.sendTimeIst = t;
    }
    if (patch.dateRange !== undefined) {
      if (
        patch.dateRange !== 'yesterday' &&
        patch.dateRange !== 'month_to_date' &&
        patch.dateRange !== 'year_to_yesterday'
      ) {
        throw new Error('Invalid date range');
      }
      nextPrefs.dateRange = patch.dateRange;
    }
    if (patch.toEmails !== undefined) {
      nextPrefs.toEmails = normalizeEmailList(patch.toEmails);
    }
    if (patch.ccEmails !== undefined) {
      nextPrefs.ccEmails = normalizeEmailList(patch.ccEmails);
    }

    assertAllowedEmailDomains(
      [...resolveMisEmailToEmails(nextPrefs), ...resolveMisEmailCcEmails(nextPrefs)],
      allowedEmailDomains
    );

    const enabled =
      patch.misEmailEnabled !== undefined
        ? Boolean(patch.misEmailEnabled)
        : Boolean(row.mis_email_enabled);

    const updated = await client.query<Row>(
      `UPDATE public.app_users
       SET mis_email_preferences = $2::jsonb,
           mis_email_enabled = $3
       WHERE id = $1
       RETURNING id, name, email, mis_email_enabled, mis_email_preferences`,
      [userId, JSON.stringify(nextPrefs), enabled]
    );
    const next = updated.rows[0];
    if (!next) throw new Error('User not found');
    return { before, user: rowToSchedule(next) };
  });
}
