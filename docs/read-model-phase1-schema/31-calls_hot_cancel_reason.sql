-- Chunk 31: cancel_reason label on calls_latest_hot (mstcallcancelreasons.vname).
-- Synced from CRM with the call row; backfill from master codes after apply.

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN calls_latest_hot.cancel_reason IS
  'Cancel reason label from mstcallcancelreasons.vname; null when not cancelled / unknown.';
