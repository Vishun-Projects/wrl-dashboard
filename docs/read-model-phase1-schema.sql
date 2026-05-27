-- Read Model Phase 1 — Postgres DDL
-- Apply to Supabase/Postgres read-model database (review before running).
-- See docs/read-model-phase1-architecture.md

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE status_bucket_type AS ENUM (
  'open_unallocated',
  'assigned',
  'tech_solved',
  'solved',
  'cancelled'
);

CREATE TYPE sync_batch_status AS ENUM (
  'started',
  'completed',
  'partial',
  'failed'
);

CREATE TYPE sync_run_status AS ENUM (
  'started',
  'completed',
  'failed'
);

-- ---------------------------------------------------------------------------
-- calls_latest_hot — one row per vtrnno (90d + open-old exception)
-- ---------------------------------------------------------------------------

CREATE TABLE calls_latest_hot (
  ncode                 bigint NOT NULL,
  vtrnno                varchar(50) NOT NULL,
  vcclid                varchar(50),
  nofficeid             bigint NOT NULL,
  nengineer             bigint,
  office_under          bigint,
  franchisee_code       varchar(50),
  party_name            text,
  branch_name           varchar(255),
  franchisee_name       varchar(255),
  pincode               varchar(20),
  city                  varchar(255),
  state                 varchar(100),
  region                varchar(100) NOT NULL DEFAULT 'OTHER',
  account               varchar(255) NOT NULL DEFAULT 'UNCLASSIFIED',
  item_name             varchar(255),
  serial                varchar(100),
  engineer_name         varchar(255),
  call_type             varchar(100),
  complaint             text,
  status_label          varchar(50),
  status_bucket         status_bucket_type NOT NULL,
  solve_remarks         text,
  contact_person        varchar(255),
  phone                 varchar(50),
  address               text,
  has_visit             boolean NOT NULL DEFAULT false,
  is_major              boolean NOT NULL DEFAULT false,
  is_part_pending       boolean NOT NULL DEFAULT false,
  branch_headcount      integer NOT NULL DEFAULT 0,
  logged_at             timestamptz NOT NULL,
  solved_at             timestamptz,
  edited_at             timestamptz,
  added_at              timestamptz,
  source_editedon       timestamptz,
  bsolved               boolean,
  bfastclose            boolean,
  ncancelreason         integer,
  lat                   double precision,
  lng                   double precision,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_latest_hot_pkey PRIMARY KEY (vtrnno)
);

CREATE INDEX idx_calls_hot_logged_at
  ON calls_latest_hot (logged_at DESC, ncode DESC);

CREATE INDEX idx_calls_hot_status_logged
  ON calls_latest_hot (status_bucket, logged_at DESC);

CREATE INDEX idx_calls_hot_office_logged
  ON calls_latest_hot (nofficeid, logged_at DESC);

CREATE INDEX idx_calls_hot_call_type_logged
  ON calls_latest_hot (call_type, logged_at DESC);

CREATE INDEX idx_calls_hot_engineer_logged
  ON calls_latest_hot (nengineer, logged_at DESC)
  WHERE nengineer IS NOT NULL;

CREATE INDEX idx_calls_hot_ncode
  ON calls_latest_hot (ncode);

COMMENT ON TABLE calls_latest_hot IS
  'Phase 1 hot read model: latest deduped call per vtrnno, 90d window + open-old exception.';

-- ---------------------------------------------------------------------------
-- call_metrics_daily — YTD fact table (Phase 1 retention: current calendar year)
-- ---------------------------------------------------------------------------

CREATE TABLE call_metrics_daily (
  fact_date             date NOT NULL,
  office_id             bigint NOT NULL,
  call_type             varchar(100) NOT NULL,
  account               varchar(255) NOT NULL,
  region                varchar(100) NOT NULL,
  total                 integer NOT NULL DEFAULT 0,
  solved                integer NOT NULL DEFAULT 0,
  cancelled             integer NOT NULL DEFAULT 0,
  open_count            integer NOT NULL DEFAULT 0,
  tech_solved           integer NOT NULL DEFAULT 0,
  deployment_total      integer NOT NULL DEFAULT 0,
  deployment_done       integer NOT NULL DEFAULT 0,
  installation_total    integer NOT NULL DEFAULT 0,
  installation_done     integer NOT NULL DEFAULT 0,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_metrics_daily_pkey
    PRIMARY KEY (fact_date, office_id, call_type, account, region)
);

CREATE INDEX idx_metrics_fact_date
  ON call_metrics_daily (fact_date);

CREATE INDEX idx_metrics_office_date
  ON call_metrics_daily (office_id, fact_date);

CREATE INDEX idx_metrics_account_date
  ON call_metrics_daily (account, fact_date);

CREATE INDEX idx_metrics_region_date
  ON call_metrics_daily (region, fact_date);

COMMENT ON TABLE call_metrics_daily IS
  'Daily aggregated call counts for Summary Dashboard and Key Account MIS. Phase 1: current year only.';

-- ---------------------------------------------------------------------------
-- Dimension tables
-- ---------------------------------------------------------------------------

CREATE TABLE dim_offices (
  ncode                 bigint NOT NULL,
  vcompanyname          varchar(255),
  nunder                bigint,
  nzone                 bigint,
  is_branch             boolean NOT NULL DEFAULT false,
  region                varchar(100),
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_offices_pkey PRIMARY KEY (ncode)
);

CREATE INDEX idx_dim_offices_nunder ON dim_offices (nunder);
CREATE INDEX idx_dim_offices_name ON dim_offices (vcompanyname);

CREATE TABLE dim_engineers (
  ncode                 bigint NOT NULL,
  vname                 varchar(255) NOT NULL,
  nofficeid             bigint,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_engineers_pkey PRIMARY KEY (ncode)
);

CREATE INDEX idx_dim_engineers_office ON dim_engineers (nofficeid);
CREATE INDEX idx_dim_engineers_name ON dim_engineers (vname);

CREATE TABLE dim_call_types (
  ncode                 bigint NOT NULL,
  display_value         varchar(100) NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_call_types_pkey PRIMARY KEY (ncode)
);

CREATE INDEX idx_dim_call_types_display ON dim_call_types (display_value);

-- ---------------------------------------------------------------------------
-- Sync metadata
-- ---------------------------------------------------------------------------

CREATE TABLE sync_state (
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

CREATE TABLE sync_run_log (
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

CREATE INDEX idx_sync_run_log_created
  ON sync_run_log (started_at DESC);

COMMENT ON TABLE sync_run_log IS
  'Operational sync logs. Retain 30 days (purge via scheduled job).';

CREATE TABLE raw_ingest_batches (
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

CREATE INDEX idx_raw_ingest_entity_created
  ON raw_ingest_batches (entity, created_at DESC);

COMMENT ON TABLE raw_ingest_batches IS
  'Immutable batch audit for reconciliation. No payload storage. Retain 90 days.';

-- ---------------------------------------------------------------------------
-- Seed sync_state entities
-- ---------------------------------------------------------------------------

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('calls_latest_hot', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill'),
  ('call_metrics_daily', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill'),
  ('dim_offices', NULL, NULL, 'pending_backfill'),
  ('dim_engineers', NULL, NULL, 'pending_backfill'),
  ('dim_call_types', NULL, NULL, 'pending_backfill');

COMMIT;
