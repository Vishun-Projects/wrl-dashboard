-- User UI theme preference: white | cream | dark
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'cream';

ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_theme_check;

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_theme_check CHECK (theme IN ('white', 'cream', 'dark'));
