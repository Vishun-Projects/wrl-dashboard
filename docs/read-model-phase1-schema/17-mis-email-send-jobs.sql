-- MIS email background send job status (survives dev HMR and serverless cold starts).
-- SAFE: additive only.

CREATE TABLE IF NOT EXISTS public.mis_email_send_jobs (
  job_id        uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  status        text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  message       text NOT NULL DEFAULT '',
  sent          jsonb,
  error_message text,
  duration_ms   integer,
  timing        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mis_email_send_jobs_user_updated
  ON public.mis_email_send_jobs (user_id, updated_at DESC);

COMMENT ON TABLE public.mis_email_send_jobs IS
  'Per-user MIS email compose/send jobs for background status polling.';
