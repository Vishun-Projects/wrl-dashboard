-- Security audit + session ledger tables.
-- Append-only event log for auth/session/admin/export/operational actions.

CREATE TABLE IF NOT EXISTS public.security_audit_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  result text NOT NULL,
  actor_user_id uuid NULL,
  actor_email text NULL,
  session_id uuid NULL,
  route text NULL,
  method text NULL,
  ip text NULL,
  user_agent text NULL,
  target_type text NULL,
  target_id text NULL,
  target_label text NULL,
  status_code integer NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_created_at
  ON public.security_audit_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_event_type_created_at
  ON public.security_audit_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_actor_created_at
  ON public.security_audit_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_events_session_created_at
  ON public.security_audit_events (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  session_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  user_id uuid NULL,
  user_email text NULL,
  auth_method text NULL,
  ip text NULL,
  user_agent text NULL,
  status text NOT NULL DEFAULT 'active',
  ended_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_started_at
  ON public.auth_sessions (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id_started_at
  ON public.auth_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_status_started_at
  ON public.auth_sessions (status, started_at DESC);

COMMENT ON TABLE public.security_audit_events IS
  'Security and audit trail for auth, access control, admin mutations, exports, and operational actions.';
COMMENT ON TABLE public.auth_sessions IS
  'Application session ledger for sign-in/sign-out and lifecycle tracking.';
