-- Chunk 67: Warranty Provision SNAP — billing_year, recompute end/FY, drop stored remaining/status.
-- Idempotent. Run statements separately (do NOT wrap the whole file in one long transaction):
--   DROP COLUMN needs AccessExclusiveLock; keep that short and after backfill commits.

ALTER TABLE warranty_provision_rows
  ADD COLUMN IF NOT EXISTS billing_year integer;

-- Recompute end date from start + days (ignore Excel formula columns).
UPDATE warranty_provision_rows
SET warranty_end_date = warranty_start + (days::integer)
WHERE warranty_start IS NOT NULL
  AND days IS NOT NULL
  AND (
    warranty_end_date IS NULL
    OR warranty_end_date IS DISTINCT FROM (warranty_start + (days::integer))
  );

UPDATE warranty_provision_rows
SET
  warranty_end_fy = CASE
    WHEN warranty_end_date IS NULL THEN ''
    WHEN EXTRACT(MONTH FROM warranty_end_date) >= 4
      THEN lpad((EXTRACT(YEAR FROM warranty_end_date)::int % 100)::text, 2, '0')
        || '-'
        || lpad(((EXTRACT(YEAR FROM warranty_end_date)::int + 1) % 100)::text, 2, '0')
    ELSE lpad(((EXTRACT(YEAR FROM warranty_end_date)::int - 1) % 100)::text, 2, '0')
      || '-'
      || lpad((EXTRACT(YEAR FROM warranty_end_date)::int % 100)::text, 2, '0')
  END
WHERE warranty_end_date IS NOT NULL
  AND warranty_end_fy IS DISTINCT FROM (
    CASE
      WHEN EXTRACT(MONTH FROM warranty_end_date) >= 4
        THEN lpad((EXTRACT(YEAR FROM warranty_end_date)::int % 100)::text, 2, '0')
          || '-'
          || lpad(((EXTRACT(YEAR FROM warranty_end_date)::int + 1) % 100)::text, 2, '0')
      ELSE lpad(((EXTRACT(YEAR FROM warranty_end_date)::int - 1) % 100)::text, 2, '0')
        || '-'
        || lpad((EXTRACT(YEAR FROM warranty_end_date)::int % 100)::text, 2, '0')
    END
  );

UPDATE warranty_provision_rows
SET billing_year = EXTRACT(YEAR FROM billing_date)::int
WHERE billing_date IS NOT NULL
  AND billing_year IS DISTINCT FROM EXTRACT(YEAR FROM billing_date)::int;

CREATE INDEX IF NOT EXISTS idx_wp_rows_billing_year
  ON warranty_provision_rows (billing_year);

CREATE INDEX IF NOT EXISTS idx_wp_rows_warranty_end
  ON warranty_provision_rows (warranty_end_date);

CREATE INDEX IF NOT EXISTS idx_wp_rows_warranty_start
  ON warranty_provision_rows (warranty_start);

-- Dedupe before unique index: keep lowest id per (billing_document, serial_number).
DELETE FROM warranty_provision_rows a
USING warranty_provision_rows b
WHERE a.id > b.id
  AND a.billing_document = b.billing_document
  AND a.serial_number = b.serial_number
  AND a.billing_document <> ''
  AND a.serial_number <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_wp_doc_serial
  ON warranty_provision_rows (billing_document, serial_number)
  WHERE billing_document <> '' AND serial_number <> '';

-- Short exclusive lock — run alone after the backfill above has committed.
ALTER TABLE warranty_provision_rows DROP COLUMN IF EXISTS remaining_days;
ALTER TABLE warranty_provision_rows DROP COLUMN IF EXISTS warranty_remaining_days;

DROP INDEX IF EXISTS idx_wp_rows_remaining_label;

-- Claims + assumptions (Phase 2)
CREATE TABLE IF NOT EXISTS warranty_claims (
  id                    bigserial PRIMARY KEY,
  claim_no              text NOT NULL DEFAULT '',
  serial_number         text NOT NULL DEFAULT '',
  claim_date            date,
  defect_description    text NOT NULL DEFAULT '',
  repair_cost           numeric(14,2),
  spare_parts_cost      numeric(14,2),
  labour_cost           numeric(14,2),
  replacement_cost      numeric(14,2),
  total_cost            numeric(14,2),
  unit_id               bigint REFERENCES warranty_provision_rows(id) ON DELETE SET NULL,
  match_status          text NOT NULL DEFAULT 'unmatched',
  imported_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_warranty_claims_claim_no
  ON warranty_claims (claim_no);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_serial
  ON warranty_claims (serial_number);

CREATE INDEX IF NOT EXISTS idx_warranty_claims_date
  ON warranty_claims (claim_date);

CREATE TABLE IF NOT EXISTS warranty_forecast_assumptions (
  id                        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  inflation_pct             numeric(8,4) NOT NULL DEFAULT 5,
  discount_pct              numeric(8,4) NOT NULL DEFAULT 8,
  optimistic_prob_mult      numeric(8,4) NOT NULL DEFAULT 0.8,
  optimistic_cost_mult      numeric(8,4) NOT NULL DEFAULT 0.9,
  pessimistic_prob_mult     numeric(8,4) NOT NULL DEFAULT 1.2,
  pessimistic_cost_mult     numeric(8,4) NOT NULL DEFAULT 1.25,
  forecast_start            date,
  include_future_sales      boolean NOT NULL DEFAULT false,
  existing_provision        numeric(18,2) NOT NULL DEFAULT 0,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO warranty_forecast_assumptions (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
