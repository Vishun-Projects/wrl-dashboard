-- Persist uploaded MIS files in Postgres (required on Vercel — /tmp is ephemeral).

ALTER TABLE mis_client_import_batches
  ADD COLUMN IF NOT EXISTS stored_file_blob bytea;

COMMENT ON COLUMN mis_client_import_batches.stored_file_blob IS
  'Original upload bytes. Primary download source on serverless; complements stored_file_path on VPS.';
