-- Remove persisted report preferences (filters, columns, last report path).
ALTER TABLE public.app_users
  DROP COLUMN IF EXISTS report_preferences;
