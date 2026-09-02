-- Migrate legacy MIS tab permission names to canonical tab_* names.
-- Run once on production before removing TAB_PERMISSION_ALIASES from rbac-catalog.ts.
--
--   psql "$DATABASE_URL" -f scripts/rbac/migrate-tab-permission-aliases.sql

INSERT INTO public.app_role_permissions (role_id, permission_id)
SELECT DISTINCT arp.role_id, canonical.id
FROM public.app_role_permissions arp
JOIN public.app_permissions legacy ON legacy.id = arp.permission_id
JOIN public.app_permissions canonical ON canonical.name = CASE legacy.name
  WHEN 'view_mis_summary' THEN 'tab_mis_summary'
  WHEN 'view_summary' THEN 'tab_mis_summary'
  WHEN 'view_mis_register' THEN 'tab_mis_register'
  WHEN 'view_mis_accounts' THEN 'tab_mis_accounts'
END
WHERE legacy.name IN (
  'view_mis_summary',
  'view_summary',
  'view_mis_register',
  'view_mis_accounts'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM public.app_role_permissions arp
USING public.app_permissions p
WHERE p.id = arp.permission_id
  AND p.name IN (
    'view_mis_summary',
    'view_summary',
    'view_mis_register',
    'view_mis_accounts'
  );
