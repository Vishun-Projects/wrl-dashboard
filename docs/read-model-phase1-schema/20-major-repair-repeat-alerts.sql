-- Dedup log for major repair repeat alert emails (sync worker).
-- SAFE: additive only.

CREATE TABLE IF NOT EXISTS major_repair_repeat_alert_sent (
  vtrnno     varchar(50) PRIMARY KEY,
  serial     varchar(100) NOT NULL,
  call_count integer NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_major_repair_repeat_alert_serial
  ON major_repair_repeat_alert_sent (serial, sent_at DESC);

COMMENT ON TABLE major_repair_repeat_alert_sent IS
  'Per-TRN dedup for VPS sync major repair repeat alert emails.';
