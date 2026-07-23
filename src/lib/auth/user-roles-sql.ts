/**
 * SQL fragment: resolve a user's assigned roles from app_user_roles,
 * falling back to app_users.role_id when the junction has no rows yet.
 * Exposes column alias `assigned.role_id` (requires FROM alias `u` for app_users).
 */
export const USER_ASSIGNED_ROLES_LATERAL = `
LEFT JOIN LATERAL (
  SELECT role_id FROM public.app_user_roles WHERE user_id = u.id
  UNION ALL
  SELECT u.role_id
  WHERE u.role_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.app_user_roles x WHERE x.user_id = u.id)
) assigned(role_id) ON true
`;

/** Aggregate role_ids for list/bootstrap payloads (subquery on u.id). */
export const USER_ROLE_IDS_SUBSELECT = `
COALESCE(
  (
    SELECT array_agg(aur.role_id ORDER BY r.name ASC)
    FROM public.app_user_roles aur
    JOIN public.app_roles r ON r.id = aur.role_id
    WHERE aur.user_id = u.id
  ),
  CASE WHEN u.role_id IS NOT NULL THEN ARRAY[u.role_id] ELSE '{}'::uuid[] END
)
`;
