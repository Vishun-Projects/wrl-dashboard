-- Chunk 27: Athena Failed Calls Sync, Historical Archive & CRM Call Register Reconciliation
-- Source: CRM rpt_failedathenacalls table
-- Reconciles against calls_latest_hot / trhcalls on (call_type, outlet_name, serial_no, crm.logged_at >= failed.call_date)

CREATE TABLE IF NOT EXISTS athena_failed_calls_raw (
  id                    bigserial PRIMARY KEY,
  client_caption        text,
  branch_name           text,
  client_ticket_no      text,
  mc_status             text,
  call_type             text,
  nature_of_complaint   text,
  received_date_raw     text,
  asp_office_id         text,
  outlet_name           text,
  client_code1          text,
  client                text,
  town                  text,
  area_name             text,
  outlet_name_address   text,
  pincode               text,
  phone                 text,
  model                 text,
  serial_no             text,
  asset_no1             text,
  invoice_no            text,
  product_status        text,
  invoice_date_raw      text,
  result                text,
  result_value          text,
  addedon_raw           text,
  ingestion_batch_id    text,
  source_identifier     text NOT NULL DEFAULT 'crm:rpt_failedathenacalls',
  raw_fingerprint       text NOT NULL UNIQUE,
  ingested_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_athena_raw_ingested_at
  ON athena_failed_calls_raw (ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_athena_raw_addedon
  ON athena_failed_calls_raw (addedon_raw);

CREATE TABLE IF NOT EXISTS athena_failed_calls_normalized (
  id                    bigserial PRIMARY KEY,
  raw_fingerprint       text NOT NULL UNIQUE,
  client_caption        text,
  branch_name           text,
  client_ticket_no      text,
  mc_status             text,
  call_type             text,
  nature_of_complaint   text,
  outlet_name           text,
  outlet_address        text,
  pincode               text,
  phone                 text,
  model                 text,
  serial_no             text,
  asset_no              text,
  invoice_no            text,
  product_status        text,
  result                text,
  result_value          text,
  failure_reason        text,
  call_date             timestamptz,
  received_date         timestamptz,
  addedon_at            timestamptz,
  is_valid_matching_data boolean NOT NULL DEFAULT true,
  invalid_reason        text,
  reconciliation_status text NOT NULL DEFAULT 'NOT_REGISTERED', -- 'REGISTERED', 'NOT_REGISTERED', 'MULTIPLE_MATCHES', 'INVALID_DATA'
  match_count           integer NOT NULL DEFAULT 0,
  matched_vtrnno        text,
  matched_vtrnnos       text[],
  matched_crm_logged_at timestamptz,
  matched_crm_status    text,
  matched_crm_party_name text,
  matched_crm_call_type text,
  matched_crm_serial    text,
  reconciled_at         timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Fast indexes for matching, filtering, and reporting
CREATE INDEX IF NOT EXISTS idx_athena_norm_matching_keys
  ON athena_failed_calls_normalized (call_type, outlet_name, serial_no, call_date);

CREATE INDEX IF NOT EXISTS idx_athena_norm_status_calldate
  ON athena_failed_calls_normalized (reconciliation_status, call_date DESC);

CREATE INDEX IF NOT EXISTS idx_athena_norm_serial
  ON athena_failed_calls_normalized (serial_no);

CREATE INDEX IF NOT EXISTS idx_athena_norm_outlet
  ON athena_failed_calls_normalized (outlet_name);

CREATE INDEX IF NOT EXISTS idx_athena_norm_branch
  ON athena_failed_calls_normalized (branch_name);

CREATE INDEX IF NOT EXISTS idx_athena_norm_client
  ON athena_failed_calls_normalized (client_caption);

CREATE INDEX IF NOT EXISTS idx_athena_norm_reason
  ON athena_failed_calls_normalized (failure_reason);

CREATE INDEX IF NOT EXISTS idx_athena_norm_ticket
  ON athena_failed_calls_normalized (client_ticket_no);

CREATE TABLE IF NOT EXISTS athena_reconciliation_runs (
  run_id                bigserial PRIMARY KEY,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  run_mode              text NOT NULL DEFAULT 'incremental',
  status                text NOT NULL DEFAULT 'running',
  total_failed_records  integer NOT NULL DEFAULT 0,
  registered_count      integer NOT NULL DEFAULT 0,
  not_registered_count  integer NOT NULL DEFAULT 0,
  multiple_matches_count integer NOT NULL DEFAULT 0,
  invalid_data_count    integer NOT NULL DEFAULT 0,
  new_raw_ingested      integer NOT NULL DEFAULT 0,
  error_message         text
);

CREATE INDEX IF NOT EXISTS idx_athena_rec_runs_started
  ON athena_reconciliation_runs (started_at DESC);

COMMENT ON TABLE athena_failed_calls_raw IS
  'Raw immutable capture of failed Athena calls from CRM rpt_failedathenacalls for audit and deduplication.';

COMMENT ON TABLE athena_failed_calls_normalized IS
  'Normalized failed Athena calls with status tracking and 4-way CRM reconciliation metadata.';

COMMENT ON TABLE athena_reconciliation_runs IS
  'Audit log of Athena sync and reconciliation runs.';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('athena_failed_calls', NULL, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;
