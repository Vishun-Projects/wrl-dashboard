-- Chunk 38: SAP item code (mstitems.vitemcode) on hot + mirror read models.
ALTER TABLE calls_crm_mirror
  ADD COLUMN IF NOT EXISTS item_code varchar(50);

ALTER TABLE calls_latest_hot
  ADD COLUMN IF NOT EXISTS item_code varchar(50);
