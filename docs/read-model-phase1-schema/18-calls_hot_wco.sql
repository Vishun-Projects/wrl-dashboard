-- WCO (Warranty / Contract / Out / Void) on calls_latest_hot from CRM mstprorg via trhcalls.nitemserialno.
-- SAFE: additive only — does NOT truncate or delete calls_latest_hot rows.
-- Does NOT modify Western CRM tables (read-only from this app).

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS wco varchar(1);

COMMENT ON COLUMN calls_latest_hot.wco IS
  'Derived W/C/O/V from mstprorg warranty/contract dates as of call dtrndate; null when no serial link.';
