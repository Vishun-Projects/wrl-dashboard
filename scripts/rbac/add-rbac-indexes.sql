-- RBAC lookup indexes (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_app_role_permissions_role_id
  ON public.app_role_permissions (role_id);

CREATE INDEX IF NOT EXISTS idx_app_users_role_id
  ON public.app_users (role_id);

CREATE INDEX IF NOT EXISTS idx_app_permissions_name
  ON public.app_permissions (name);
