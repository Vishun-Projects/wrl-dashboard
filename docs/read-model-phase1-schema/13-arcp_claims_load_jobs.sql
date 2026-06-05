-- ARCP Claims load job manifests (progress index; row payloads live in disk chunk cache).
-- SAFE: additive only — does not modify CRM or calls_latest_hot.

CREATE TABLE IF NOT EXISTS arcp_claims_load_jobs (
  job_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  job_key       text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('agg', 'detail')),
  filters       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'partial', 'complete')),
  total_chunks  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcp_claims_load_jobs_user_key_kind UNIQUE (user_id, job_key, kind)
);

CREATE INDEX IF NOT EXISTS idx_arcp_load_jobs_user_updated
  ON arcp_claims_load_jobs (user_id, updated_at DESC);

COMMENT ON TABLE arcp_claims_load_jobs IS
  'Per-user ARCP load progress for a filter set. Payloads stored in .cache/arcp-claims/chunks.';

CREATE TABLE IF NOT EXISTS arcp_claims_load_chunks (
  job_id          uuid NOT NULL REFERENCES arcp_claims_load_jobs (job_id) ON DELETE CASCADE,
  chunk_start     date NOT NULL,
  chunk_end       date NOT NULL,
  cache_key       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'done', 'failed')),
  error_message   text,
  completed_at    timestamptz,
  PRIMARY KEY (job_id, chunk_start, chunk_end)
);

CREATE INDEX IF NOT EXISTS idx_arcp_load_chunks_job_status
  ON arcp_claims_load_chunks (job_id, status);

COMMENT ON TABLE arcp_claims_load_chunks IS
  'One row per planned date period in an ARCP load job.';
