-- Chunk 34: keep CRM msduserlocation.nuser as numeric (e.g. 590.3).
-- Truncating to bigint collapsed every tech at an office onto one user_id.
-- SAFE: alters mirror column type only. Re-sync user-locations after apply.

ALTER TABLE crm_user_locations
  ALTER COLUMN user_id TYPE numeric
  USING user_id::numeric;

COMMENT ON COLUMN crm_user_locations.user_id IS
  'CRM msduserlocation.nuser (numeric; may be fractional e.g. 590.3 — do not truncate).';
