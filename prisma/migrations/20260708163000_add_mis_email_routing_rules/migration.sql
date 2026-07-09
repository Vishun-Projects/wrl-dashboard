CREATE TABLE IF NOT EXISTS public.mis_email_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text NOT NULL DEFAULT '',
  branch text NOT NULL DEFAULT '',
  client text NOT NULL DEFAULT '',
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  auto_send_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mis_email_routing_rules_zone_branch_client
ON public.mis_email_routing_rules (upper(btrim(zone)), upper(btrim(branch)), upper(btrim(client)));
