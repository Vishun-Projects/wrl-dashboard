-- Branch recipients + send dedupe for cancelled-call daily digests.
-- SAFE: additive only.

CREATE TABLE IF NOT EXISTS cancelled_call_digest_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch text NOT NULL,
  recipient_name text NOT NULL,
  email text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cancelled_call_digest_recipients_branch_email
  ON cancelled_call_digest_recipients (lower(btrim(branch)), lower(btrim(email)));

CREATE INDEX IF NOT EXISTS idx_cancelled_call_digest_recipients_branch
  ON cancelled_call_digest_recipients (lower(btrim(branch)))
  WHERE enabled = true;

COMMENT ON TABLE cancelled_call_digest_recipients IS
  'HOD-maintained branch → BM email recipients for cancelled-call daily digests.';

CREATE TABLE IF NOT EXISTS cancelled_call_digest_send_log (
  branch text NOT NULL,
  digest_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  message_id text,
  PRIMARY KEY (branch, digest_date)
);

COMMENT ON TABLE cancelled_call_digest_send_log IS
  'Dedupe log for cancelled-call digests keyed by branch + IST digest date.';
