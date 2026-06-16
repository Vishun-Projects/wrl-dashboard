-- CRM mirror sync metadata (database: old_crm)
CREATE SCHEMA IF NOT EXISTS crm_mirror;

CREATE TABLE IF NOT EXISTS crm_mirror.sync_state (
  table_name                text NOT NULL,
  phase                     text NOT NULL DEFAULT 'pending',
  sync_capability           text NOT NULL DEFAULT 'unknown',
  pk_column                 text,
  has_editedon              boolean NOT NULL DEFAULT false,
  has_addedon               boolean NOT NULL DEFAULT false,
  backfill_started_at       timestamptz,
  backfill_completed_at     timestamptz,
  catchup_completed_at      timestamptz,
  verified_at               timestamptz,
  backfill_high_water_ncode bigint,
  last_ncode                bigint,
  last_cursor               text,
  last_editedon             timestamptz,
  last_addedon              timestamptz,
  crm_row_count             bigint,
  rows_loaded               bigint NOT NULL DEFAULT 0,
  rows_tombstoned           bigint NOT NULL DEFAULT 0,
  catchup_empty_passes      integer NOT NULL DEFAULT 0,
  is_running                boolean NOT NULL DEFAULT false,
  last_error                text,
  last_run_at               timestamptz,
  size_kb                   bigint,
  CONSTRAINT sync_state_pkey PRIMARY KEY (table_name)
);

COMMENT ON TABLE crm_mirror.sync_state IS
  'Per-table CRM mirror sync phase and watermarks. Advance only after successful batch commit.';

CREATE TABLE IF NOT EXISTS crm_mirror.sync_batches (
  batch_id        uuid NOT NULL,
  table_name      text NOT NULL,
  phase           text NOT NULL,
  cursor_start    bigint,
  cursor_end      bigint,
  row_count       integer NOT NULL DEFAULT 0,
  checksum        text,
  status          text NOT NULL DEFAULT 'started',
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  error_message   text,
  CONSTRAINT sync_batches_pkey PRIMARY KEY (batch_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_batches_table_started
  ON crm_mirror.sync_batches (table_name, started_at DESC);

CREATE TABLE IF NOT EXISTS crm_mirror.sync_verifications (
  id            bigserial PRIMARY KEY,
  table_name    text NOT NULL,
  gate_name     text NOT NULL,
  crm_value     text,
  mirror_value  text,
  passed        boolean NOT NULL,
  run_at        timestamptz NOT NULL DEFAULT now(),
  details_json  jsonb
);

CREATE INDEX IF NOT EXISTS idx_sync_verifications_table_run
  ON crm_mirror.sync_verifications (table_name, run_at DESC);

CREATE SCHEMA IF NOT EXISTS crm_raw;

COMMENT ON SCHEMA crm_raw IS
  'Raw CRM table mirrors — columns stored as text initially. Filter _mirror_deleted_at IS NULL for live parity.';
