-- BM call approval on calls_latest_hot (from live trhcalls.bapproval + editedon).
-- ARCP Claims report uses live CRM; this supports Register / Postgres register reads.
--
-- SAFE: additive only — does NOT truncate or delete calls_latest_hot rows.
-- Does NOT modify Western CRM trhcalls (read-only from this app).

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS bapproval boolean,
  ADD COLUMN IF NOT EXISTS bm_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_calls_hot_bm_approved_at
  ON calls_latest_hot (bm_approved_at DESC, office_under)
  WHERE bm_approved_at IS NOT NULL;

COMMENT ON COLUMN calls_latest_hot.bapproval IS
  'trhcalls.bapproval when row was synced (BM call approved flag).';
COMMENT ON COLUMN calls_latest_hot.bm_approved_at IS
  'trhcalls.editedon when bapproval is true — same basis as ARCP Claims BM Call Approved.';
