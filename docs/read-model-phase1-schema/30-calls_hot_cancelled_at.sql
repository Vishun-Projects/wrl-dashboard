-- Chunk 30: cancelled_at on calls_latest_hot.
-- Same cancel datetime basis as calls_cancelled: last trhcalls.editedon
-- (hot.edited_at → source_editedon → logged_at).
-- SAFE: additive only. Does not modify Western CRM.

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN calls_latest_hot.cancelled_at IS
  'Cancel datetime for cancelled rows = trhcalls.editedon (edited_at). NULL when not cancelled.';

UPDATE calls_latest_hot
SET cancelled_at = COALESCE(edited_at, source_editedon, logged_at)
WHERE cancelled_at IS NULL
  AND (
    status_bucket = 'cancelled'
    OR COALESCE(ncancelreason, 0) NOT IN (0, 2)
  );

UPDATE calls_latest_hot
SET cancelled_at = NULL
WHERE cancelled_at IS NOT NULL
  AND status_bucket IS DISTINCT FROM 'cancelled'
  AND COALESCE(ncancelreason, 0) IN (0, 2);

CREATE INDEX IF NOT EXISTS idx_calls_hot_cancelled_at
  ON calls_latest_hot (cancelled_at DESC)
  WHERE cancelled_at IS NOT NULL;
