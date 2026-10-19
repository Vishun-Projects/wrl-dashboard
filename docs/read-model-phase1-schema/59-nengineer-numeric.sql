-- Chunk 59: keep CRM nengineer / mstusers.ncode as numeric (e.g. 108.2 vs 108.3).
-- Truncating to bigint collapsed distinct technicians onto one id (roster showed the wrong name).
-- SAFE / idempotent: alters only when still bigint. Refresh dim_engineers then remap hot ids.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls_latest_hot'
      AND column_name = 'nengineer' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE calls_latest_hot
      ALTER COLUMN nengineer TYPE numeric
      USING nengineer::numeric;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calls_crm_mirror'
      AND column_name = 'nengineer' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE calls_crm_mirror
      ALTER COLUMN nengineer TYPE numeric
      USING nengineer::numeric;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dim_engineers'
      AND column_name = 'ncode' AND data_type = 'bigint'
  ) THEN
    ALTER TABLE dim_engineers
      ALTER COLUMN ncode TYPE numeric
      USING ncode::numeric;
  END IF;
END $$;

COMMENT ON COLUMN calls_latest_hot.nengineer IS
  'CRM trhcalls.nengineer (numeric; may be fractional e.g. 108.2 — do not truncate).';

COMMENT ON COLUMN calls_crm_mirror.nengineer IS
  'CRM trhcalls.nengineer (numeric; may be fractional — do not truncate).';

COMMENT ON COLUMN dim_engineers.ncode IS
  'CRM mstusers.ncode (numeric; may be fractional e.g. 108.2 — do not truncate).';
