-- Temporary chunk storage for large MIS uploads via Vercel (4.5 MB request limit).

CREATE TABLE IF NOT EXISTS mis_client_import_upload_chunks (
  upload_id     uuid NOT NULL,
  chunk_index   integer NOT NULL,
  chunk_total   integer NOT NULL,
  source_code   text NOT NULL,
  file_name     text NOT NULL,
  uploaded_by   uuid NOT NULL,
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_mis_upload_chunks_created
  ON mis_client_import_upload_chunks (created_at);

COMMENT ON TABLE mis_client_import_upload_chunks IS
  'Short-lived upload chunks assembled server-side; rows deleted after import completes.';
