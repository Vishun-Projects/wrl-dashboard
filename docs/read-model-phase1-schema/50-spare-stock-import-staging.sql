-- Chunk 50: browser-parsed MB51 row batches (1GB HTML never lands on the API).

CREATE TABLE IF NOT EXISTS spare_stock_import_uploads (
  upload_id             uuid PRIMARY KEY,
  file_name             text NOT NULL,
  uploaded_by           uuid,
  skipped               integer NOT NULL DEFAULT 0,
  parsed                integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spare_stock_import_staging (
  upload_id             uuid NOT NULL REFERENCES spare_stock_import_uploads(upload_id) ON DELETE CASCADE,
  seq                   integer NOT NULL,
  row_key               text NOT NULL,
  payload               jsonb NOT NULL,
  PRIMARY KEY (upload_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_spare_stock_import_staging_row_key
  ON spare_stock_import_staging (upload_id, row_key);

COMMENT ON TABLE spare_stock_import_staging IS
  'Parsed MB51 rows posted in gzip JSON batches; preview/commit read from here.';
