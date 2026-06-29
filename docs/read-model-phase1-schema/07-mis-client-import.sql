-- MIS client import (Coke / Cadbury) — dynamic mapping + stored import rows

CREATE TABLE IF NOT EXISTS mis_client_sources (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  file_kind             text NOT NULL CHECK (file_kind IN ('csv', 'xlsx')),
  delimiter             text,
  header_row_index      integer NOT NULL DEFAULT 1,
  call_key_column       text NOT NULL,
  crm_account_filter    text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mis_client_sources IS
  'Client file sources (Coke, Cadbury, etc.) with parser settings.';

CREATE TABLE IF NOT EXISTS mis_client_field_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             uuid NOT NULL REFERENCES mis_client_sources(id) ON DELETE CASCADE,
  client_column         text NOT NULL,
  crm_field             text NOT NULL,
  transform             jsonb,
  UNIQUE (source_id, client_column)
);

CREATE TABLE IF NOT EXISTS mis_client_status_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             uuid NOT NULL REFERENCES mis_client_sources(id) ON DELETE CASCADE,
  client_status         text NOT NULL,
  status_bucket         status_bucket_type NOT NULL,
  status_label          text NOT NULL,
  UNIQUE (source_id, client_status)
);

CREATE TABLE IF NOT EXISTS mis_client_state_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             uuid NOT NULL REFERENCES mis_client_sources(id) ON DELETE CASCADE,
  client_state          text NOT NULL,
  plan_code             text,
  region_override       text,
  UNIQUE (source_id, client_state)
);

CREATE TABLE IF NOT EXISTS mis_client_import_batches (
  batch_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id             uuid NOT NULL REFERENCES mis_client_sources(id),
  uploaded_by           uuid NOT NULL,
  file_name             text NOT NULL,
  filter_start          date,
  filter_end            date,
  row_count             integer NOT NULL DEFAULT 0,
  error_count           integer NOT NULL DEFAULT 0,
  status                sync_batch_status NOT NULL DEFAULT 'started',
  is_active             boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mis_client_batches_source_active
  ON mis_client_import_batches (source_id, is_active, created_at DESC);

COMMENT ON TABLE mis_client_import_batches IS
  'User-uploaded client MIS files. Latest successful batch per source is_active.';

CREATE TABLE IF NOT EXISTS mis_client_import_rows (
  id                    bigserial PRIMARY KEY,
  batch_id              uuid NOT NULL REFERENCES mis_client_import_batches(batch_id) ON DELETE CASCADE,
  call_key              text NOT NULL,
  logged_at             timestamptz,
  solved_at             timestamptz,
  status_bucket         status_bucket_type NOT NULL,
  status_label          text,
  region                text NOT NULL DEFAULT 'OTHER',
  state                 text,
  branch_label          text,
  complaint             text,
  call_type             text,
  is_part_pending       boolean NOT NULL DEFAULT false,
  engineer_name         text,
  raw                   jsonb NOT NULL,
  UNIQUE (batch_id, call_key)
);

CREATE INDEX IF NOT EXISTS idx_mis_client_rows_batch
  ON mis_client_import_rows (batch_id);

CREATE INDEX IF NOT EXISTS idx_mis_client_rows_logged
  ON mis_client_import_rows (batch_id, logged_at);

CREATE INDEX IF NOT EXISTS idx_mis_client_rows_region
  ON mis_client_import_rows (batch_id, region);

COMMENT ON TABLE mis_client_import_rows IS
  'Normalized rows from client MIS imports for summary comparison.';
