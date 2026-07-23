-- Multi-role assignment: one user can hold many roles; permissions are the union.
-- Primary display role remains app_users.role_id (first assigned).

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.app_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_roles_role_id
  ON public.app_user_roles (role_id);

CREATE INDEX IF NOT EXISTS idx_app_user_roles_user_id
  ON public.app_user_roles (user_id);

-- Backfill from existing single role_id
INSERT INTO public.app_user_roles (user_id, role_id)
SELECT id, role_id
FROM public.app_users
WHERE role_id IS NOT NULL
ON CONFLICT DO NOTHING;
