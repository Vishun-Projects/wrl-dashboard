-- Chunk 41: ZSS02 spare loan check — one import snapshot per plant (overwrite on re-upload).

CREATE TABLE IF NOT EXISTS spare_loan_check_imports (
  plant                 text PRIMARY KEY,
  file_name             text NOT NULL,
  uploaded_by           uuid,
  parsed                integer NOT NULL DEFAULT 0,
  skipped               integer NOT NULL DEFAULT 0,
  ok                    integer NOT NULL DEFAULT 0,
  problems              integer NOT NULL DEFAULT 0,
  by_reason             jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE spare_loan_check_imports IS
  'Latest ZSS02 spare-loan check per SAP plant. Re-upload for the same plant overwrites.';

CREATE TABLE IF NOT EXISTS spare_loan_check_rows (
  id                    bigserial PRIMARY KEY,
  plant                 text NOT NULL REFERENCES spare_loan_check_imports(plant) ON DELETE CASCADE,
  vendor_no             text NOT NULL,
  vendor_name           text,
  material              text,
  material_description  text,
  barcode               text,
  so_loan               text,
  so_con_rtn            text,
  match_key             text NOT NULL,
  match_source          text NOT NULL,
  crm_vtrnno            text,
  crm_vendor_code       text,
  reason                text NOT NULL,
  cancel_reason         text
);

CREATE INDEX IF NOT EXISTS idx_spare_loan_check_rows_plant
  ON spare_loan_check_rows (plant);

CREATE INDEX IF NOT EXISTS idx_spare_loan_check_rows_match_key
  ON spare_loan_check_rows (match_key);

COMMENT ON TABLE spare_loan_check_rows IS
  'Problem rows from the latest spare-loan check for a plant (vendor mismatch / cancelled).';
