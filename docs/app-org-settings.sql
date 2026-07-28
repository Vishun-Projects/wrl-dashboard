-- Org-wide settings (MIS email defaults, domain allowlist, outbound kill-switch, etc.).
CREATE TABLE IF NOT EXISTS public.app_org_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

COMMENT ON TABLE public.app_org_settings IS
  'Key/value org config. MIS email uses key mis_email. Missing key → code fallbacks (no silent prod break until admin saves).';
