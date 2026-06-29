-- MIS client import v2: file persistence, source_id on rows, batch history

ALTER TABLE mis_client_import_batches
  ADD COLUMN IF NOT EXISTS stored_file_path text;

ALTER TABLE mis_client_import_rows
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES mis_client_sources(id);

UPDATE mis_client_import_rows r
SET source_id = b.source_id
FROM mis_client_import_batches b
WHERE r.batch_id = b.batch_id
  AND r.source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mis_client_rows_source_call
  ON mis_client_import_rows (source_id, call_key);

CREATE INDEX IF NOT EXISTS idx_mis_client_batches_source_created
  ON mis_client_import_batches (source_id, created_at DESC);

COMMENT ON COLUMN mis_client_import_batches.stored_file_path IS
  'Relative path under MIS_CLIENT_IMPORT_DIR where the uploaded file is stored.';

COMMENT ON COLUMN mis_client_import_rows.source_id IS
  'Denormalized source for latest-batch-wins dedupe queries.';
