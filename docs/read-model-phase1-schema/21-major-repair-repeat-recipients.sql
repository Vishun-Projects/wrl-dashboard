-- Branch recipients for major repair repeat SLA alert emails (sync worker + admin UI).
-- SAFE: additive only.

CREATE TABLE IF NOT EXISTS major_repair_repeat_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch text NOT NULL,
  recipient_name text NOT NULL,
  email text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_major_repair_repeat_recipients_branch_email
  ON major_repair_repeat_recipients (lower(btrim(branch)), lower(btrim(email)));

CREATE INDEX IF NOT EXISTS idx_major_repair_repeat_recipients_branch
  ON major_repair_repeat_recipients (lower(btrim(branch)))
  WHERE enabled = true;

COMMENT ON TABLE major_repair_repeat_recipients IS
  'Maintained branch → name/email recipients for major repair repeat SLA alerts.';
