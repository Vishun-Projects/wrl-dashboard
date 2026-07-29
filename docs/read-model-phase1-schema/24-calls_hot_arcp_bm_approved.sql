-- ARCP claim BM approved date on calls_latest_hot.
-- Source: arcp_lines_hot.bm_approved_at for the matched non-rejected ARCP line.
-- Distinct from bm_approved_at which is the call-level trhcalls.editedon when bapproval=true.

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS arcp_bm_approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_calls_hot_arcp_bm_approved_at
  ON calls_latest_hot (arcp_bm_approved_at DESC, office_under)
  WHERE arcp_bm_approved_at IS NOT NULL;

COMMENT ON COLUMN calls_latest_hot.arcp_bm_approved_at IS
  'BM approved date from matched ARCP claim line (arcp_lines_hot.bm_approved_at). NULL if no ARCP claim exists.';
