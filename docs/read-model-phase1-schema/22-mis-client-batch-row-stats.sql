-- Denormalize per-batch active/new row stats so /meta does not window the rows table on every GET.

ALTER TABLE mis_client_import_batches
  ADD COLUMN IF NOT EXISTS active_row_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_row_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN mis_client_import_batches.active_row_count IS
  'Rows in this batch that are the latest for their (source_id, call_key); refreshed on upload/delete.';
COMMENT ON COLUMN mis_client_import_batches.new_row_count IS
  'Rows whose first completed batch for the call_key is this batch; refreshed on upload/delete.';

-- One-shot backfill (same semantics as former listSourceBatches window).
WITH keyed AS (
  SELECT
    r.batch_id,
    b.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY r.source_id, r.call_key
      ORDER BY b.created_at DESC
    ) AS rn,
    MIN(b.created_at) OVER (PARTITION BY r.source_id, r.call_key) AS first_batch_at
  FROM mis_client_import_rows r
  JOIN mis_client_import_batches b ON b.batch_id = r.batch_id
  WHERE b.status = 'completed'
),
batch_stats AS (
  SELECT
    batch_id,
    count(*) FILTER (WHERE rn = 1)::int AS active_rows,
    count(*) FILTER (WHERE created_at = first_batch_at)::int AS new_rows
  FROM keyed
  GROUP BY batch_id
)
UPDATE mis_client_import_batches b
SET
  active_row_count = COALESCE(stats.active_rows, 0),
  new_row_count = COALESCE(stats.new_rows, 0)
FROM batch_stats stats
WHERE stats.batch_id = b.batch_id;
