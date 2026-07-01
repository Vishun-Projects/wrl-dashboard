-- MIS email digest eligibility (admin) and user preferences (profile).
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS mis_email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mis_email_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_app_users_mis_email_enabled
  ON public.app_users (mis_email_enabled)
  WHERE mis_email_enabled = true;
