-- Chunk 60: keep CRM attendance userid as numeric (e.g. 133.2).
-- Same class of bug as nengineer / msduserlocation.nuser: truncating to bigint
-- collapsed every tech under an office onto one user_id (dozens of attd_user names).
-- SAFE / idempotent. Remap from dim_engineers after apply (see scripts/ops/remap-nengineer-from-dim.ts).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'crm_attendance_details'
      AND column_name = 'user_id' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE crm_attendance_details
      ALTER COLUMN user_id TYPE numeric
      USING user_id::numeric;
  END IF;
END $$;

COMMENT ON COLUMN crm_attendance_details.user_id IS
  'CRM uv_rptattandenceDetails_New2.userid (numeric; may be fractional e.g. 133.2 — do not truncate).';
