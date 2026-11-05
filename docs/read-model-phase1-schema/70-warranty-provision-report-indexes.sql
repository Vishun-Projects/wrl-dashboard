-- Chunk 70: indexes for SNAP / active / breakdown report queries.
-- Idempotent. Safe to re-run.

-- Active-as-of filter used by active-units + breakdown EXISTS.
CREATE INDEX IF NOT EXISTS idx_wp_rows_end_billing
  ON warranty_provision_rows (warranty_end_date, billing_date)
  WHERE warranty_end_date IS NOT NULL AND billing_date IS NOT NULL;

-- Month solved Breakdown / detail range scans.
CREATE INDEX IF NOT EXISTS idx_calls_hot_solved_at
  ON calls_latest_hot (solved_at)
  WHERE solved_at IS NOT NULL
    AND status_bucket IN ('solved'::status_bucket_type, 'tech_solved'::status_bucket_type);

-- SNAP: billing_date < as-of already has idx_wp_rows_billing_date; keep composite for year group.
CREATE INDEX IF NOT EXISTS idx_wp_rows_billing_date_year
  ON warranty_provision_rows (billing_date, billing_year)
  WHERE billing_date IS NOT NULL;
