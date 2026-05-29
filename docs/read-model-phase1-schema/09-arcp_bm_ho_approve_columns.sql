-- Separate BM / HO approve timestamps (matches CRM dbmapproveddate / dhoapproveddate)
ALTER TABLE arcp_lines_hot
  ADD COLUMN IF NOT EXISTS bm_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ho_approved_at timestamptz;

-- Backfill approve_at from BM/HO where legacy rows only had combined column
UPDATE arcp_lines_hot
SET
  approve_at = COALESCE(ho_approved_at, bm_approved_at),
  claim_month_approve = to_char(COALESCE(ho_approved_at, bm_approved_at) AT TIME ZONE 'UTC', 'YYYY-MM')
WHERE approve_at IS NULL
  AND (ho_approved_at IS NOT NULL OR bm_approved_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_arcp_hot_bm_approved_at
  ON arcp_lines_hot (bm_approved_at DESC)
  WHERE bm_approved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arcp_hot_ho_approved_at
  ON arcp_lines_hot (ho_approved_at DESC)
  WHERE ho_approved_at IS NOT NULL;
