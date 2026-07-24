-- Shared Deployment Completion account allowlist (grid + export for non-editors).
-- SAFE: additive only. Runtime also ensure-creates via visible-clients.ts.

CREATE TABLE IF NOT EXISTS call_register_visible_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_register_visible_clients_name
  ON call_register_visible_clients (lower(btrim(client_name)));

COMMENT ON TABLE call_register_visible_clients IS
  'Shared accounts visible on Deployment Completion for non-editor users; edited by allowlisted emails.';
