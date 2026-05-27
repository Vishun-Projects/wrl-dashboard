-- Chunk 6: sync metadata tables
CREATE TABLE IF NOT EXISTS sync_state (
  entity                text NOT NULL,
  last_editedon         timestamptz,
  last_addedon          timestamptz,
  last_run_at           timestamptz,
  is_running            boolean NOT NULL DEFAULT false,
  rows_upserted_last    integer NOT NULL DEFAULT 0,
  status                text,
  CONSTRAINT sync_state_pkey PRIMARY KEY (entity)
);

COMMENT ON TABLE sync_state IS
  'Per-entity sync watermarks. Advance only after successful batch commit.';

CREATE TABLE IF NOT EXISTS sync_run_log (
  id                    bigserial PRIMARY KEY,
  entity                text NOT NULL,
  batch_id              uuid,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  duration_ms           integer,
  rows_upserted         integer NOT NULL DEFAULT 0,
  rows_deleted          integer NOT NULL DEFAULT 0,
  error_message         text,
  status                sync_run_status NOT NULL DEFAULT 'started'
);

CREATE INDEX IF NOT EXISTS idx_sync_run_log_created
  ON sync_run_log (started_at DESC);

COMMENT ON TABLE sync_run_log IS
  'Operational sync logs. Retain 30 days (purge via scheduled job).';

CREATE TABLE IF NOT EXISTS raw_ingest_batches (
  batch_id              uuid NOT NULL,
  entity                text NOT NULL,
  watermark_start       timestamptz,
  watermark_end         timestamptz,
  row_count             integer NOT NULL DEFAULT 0,
  checksum              text,
  status                sync_batch_status NOT NULL DEFAULT 'started',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_ingest_batches_pkey PRIMARY KEY (batch_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_ingest_entity_created
  ON raw_ingest_batches (entity, created_at DESC);

COMMENT ON TABLE raw_ingest_batches IS
  'Immutable batch audit for reconciliation. No payload storage. Retain 90 days.';
