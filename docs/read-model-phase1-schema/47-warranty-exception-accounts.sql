-- Chunk 47: Warranty Comparison exception accounts (AMC / compressor cover).

CREATE TABLE IF NOT EXISTS warranty_exception_accounts (
  id                          bigserial PRIMARY KEY,
  system_account              text NOT NULL,
  amc                         boolean NOT NULL DEFAULT false,
  amc_valid_upto              date,
  compressor_warranty_months  integer,
  work_done_mode              text NOT NULL DEFAULT 'none'
    CHECK (work_done_mode IN ('none', 'selected', 'any')),
  work_done_repair_ncodes     text[] NOT NULL DEFAULT '{}',
  enabled                     boolean NOT NULL DEFAULT true,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS warranty_exception_accounts_account_uidx
  ON warranty_exception_accounts (upper(trim(system_account)));

COMMENT ON TABLE warranty_exception_accounts IS
  'System accounts whose lapsed-warranty W calls are AMC- or compressor-covered on Warranty Comparison.';

INSERT INTO warranty_exception_accounts (
  system_account, amc, amc_valid_upto, compressor_warranty_months, work_done_mode
)
SELECT v.system_account, v.amc, v.amc_valid_upto, v.compressor_warranty_months, v.work_done_mode
FROM (
  VALUES
    ('Sarvaraya sugars', true,  DATE '9999-12-31', NULL::integer, 'none'),
    ('Pepsi-Bott',       false, NULL,              36,            'selected'),
    ('Havmor',           false, NULL,              24,            'selected'),
    ('Amul',             false, NULL,              48,            'selected')
) AS v(system_account, amc, amc_valid_upto, compressor_warranty_months, work_done_mode)
WHERE NOT EXISTS (
  SELECT 1
  FROM warranty_exception_accounts e
  WHERE upper(trim(e.system_account)) = upper(trim(v.system_account))
);
