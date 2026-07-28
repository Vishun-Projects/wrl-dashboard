-- Optional: grant Mail & Alerts settings page permission (synced via Roles UI / seed).
-- App also allows manage_users / manage_roles / view_all_offices via canAccessPage shortcut.
INSERT INTO public.app_permissions (name, description)
SELECT 'page_mis_email_settings', 'Mail & Alerts org settings'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_mis_email_settings'
);
