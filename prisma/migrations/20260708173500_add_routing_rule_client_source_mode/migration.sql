ALTER TABLE public.mis_email_routing_rules
ADD COLUMN IF NOT EXISTS client_source_mode text NOT NULL DEFAULT 'mail';

UPDATE public.mis_email_routing_rules
SET client_source_mode = 'mail'
WHERE client_source_mode IS NULL OR btrim(client_source_mode) = '';
