-- Chunk 4: call_metrics_daily + indexes
CREATE TABLE IF NOT EXISTS call_metrics_daily (
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

CREATE INDEX IF NOT EXISTS idx_metrics_fact_date
  ON call_metrics_daily (fact_date);

CREATE INDEX IF NOT EXISTS idx_metrics_office_date
  ON call_metrics_daily (office_id, fact_date);

CREATE INDEX IF NOT EXISTS idx_metrics_account_date
  ON call_metrics_daily (account, fact_date);

CREATE INDEX IF NOT EXISTS idx_metrics_region_date
  ON call_metrics_daily (region, fact_date);

COMMENT ON TABLE call_metrics_daily IS
  'Daily aggregated call counts for Summary Dashboard and Key Account MIS. Phase 1: current year only.';
