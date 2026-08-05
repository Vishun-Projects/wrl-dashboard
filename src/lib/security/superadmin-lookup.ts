import { withAppClient } from '@/lib/read-model/db';

/** Resolve superadmin email recipients via env or database roles. */
export async function resolveSuperAdminEmails(): Promise<string[]> {
  const explicit = process.env.SUPERADMIN_EMAIL?.trim();
  if (explicit) {
    return explicit.split(',').map((e) => e.trim()).filter(Boolean);
  }

  try {
    const rows = await withAppClient(async (client) => {
      const res = await client.query<{ email: string }>(
        `SELECT DISTINCT u.email
         FROM public.app_users u
         LEFT JOIN public.app_user_roles ur ON u.id = ur.user_id
         LEFT JOIN public.app_role_permissions rp ON ur.role_id = rp.role_id
         LEFT JOIN public.app_permissions p ON p.id = rp.permission_id
         WHERE lower(u.role) IN ('admin', 'super_admin', 'superadmin')
            OR p.name = 'super_admin'
            OR p.name = 'manage_users'`
      );
      return res.rows;
    });

    const emails = rows.map((r) => r.email).filter(Boolean);
    if (emails.length > 0) return emails;
  } catch (err) {
    console.error('[superadmin-lookup] Database query failed:', err);
  }

  const fallback = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  return fallback ? [fallback] : [];
}
