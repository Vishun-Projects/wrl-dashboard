-- Chunk 37: SAP vendor code on dim_offices (from CRM mstoffice.vsapvendorcode).
ALTER TABLE dim_offices
  ADD COLUMN IF NOT EXISTS vsapvendorcode varchar(50);

CREATE INDEX IF NOT EXISTS idx_dim_offices_vsapvendorcode
  ON dim_offices (vsapvendorcode)
  WHERE vsapvendorcode IS NOT NULL AND btrim(vsapvendorcode) <> '';
