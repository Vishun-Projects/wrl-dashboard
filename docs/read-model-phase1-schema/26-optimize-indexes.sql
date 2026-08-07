-- Chunk 26: Performance Index Optimizations & Autovacuum Tuning for Read Model
-- Designed to resolve sequential scan bottlenecks on calls_latest_hot and mis_client_import_rows,
-- and to optimize recomputeBatchRowStatsForSource and dashboard aggregation queries.

-- 1. Index for date-range queries on client import rows (Coke/Cadbury)
CREATE INDEX IF NOT EXISTS idx_mis_client_rows_logged_at
  ON mis_client_import_rows (logged_at);

-- 2. Index for source-specific date-range queries on client import rows
CREATE INDEX IF NOT EXISTS idx_mis_client_rows_source_logged
  ON mis_client_import_rows (source_id, logged_at);

-- 3. Composite index to allow Index Only Scan during recomputeBatchRowStatsForSource
CREATE INDEX IF NOT EXISTS idx_mis_client_rows_source_call_batch
  ON mis_client_import_rows (source_id, call_key, batch_id);

-- 4. Composite index to allow Index Only Scan for distinct crm account query
CREATE INDEX IF NOT EXISTS idx_calls_hot_office_account
  ON calls_latest_hot (nofficeid, account);

-- 5. Composite index for regional dashboard query filters (logged_at, office, status)
CREATE INDEX IF NOT EXISTS idx_calls_hot_office_status_logged
  ON calls_latest_hot (nofficeid, status_bucket, logged_at DESC);

-- 6. Tune autovacuum for high-churn tables to prevent bloat and keep statistics fresh
ALTER TABLE mis_client_import_rows SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE calls_latest_hot SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
