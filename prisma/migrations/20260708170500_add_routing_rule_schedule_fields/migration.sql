ALTER TABLE public.mis_email_routing_rules
  ADD COLUMN IF NOT EXISTS schedule_anchor_time_ist text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS schedule_interval_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS schedule_days_of_week text[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::text[],
  ADD COLUMN IF NOT EXISTS schedule_window_start_ist text,
  ADD COLUMN IF NOT EXISTS schedule_window_end_ist text;

CREATE TABLE IF NOT EXISTS public.mis_email_routing_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  recipient_email text NOT NULL,
  sent_to text NOT NULL,
  status text NOT NULL,
  error text,
  triggered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mis_email_routing_send_log_rule_time
ON public.mis_email_routing_send_log (rule_id, triggered_at DESC);
