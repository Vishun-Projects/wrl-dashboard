-- Chunk 39: cancelled-calls read performance — denormalize enrichment fields + IST date index.
-- SAFE: additive columns + backfill; existing queries keep working until app deploy.

ALTER TABLE calls_cancelled
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS item_code varchar(255),
  ADD COLUMN IF NOT EXISTS franchisee_vendor_code varchar(100);

-- ponytail: generated STORED column — avoids AT TIME ZONE on every report filter
ALTER TABLE calls_cancelled
  ADD COLUMN IF NOT EXISTS cancelled_date_ist date
  GENERATED ALWAYS AS ((cancelled_at AT TIME ZONE 'Asia/Kolkata')::date) STORED;

-- Backfill enrichment from mirror/hot + dim_offices (one-time for existing rows)
UPDATE calls_cancelled c
SET
  cancel_reason = src.cancel_reason,
  item_code = src.item_code,
  franchisee_vendor_code = src.franchisee_vendor_code
FROM (
  SELECT
    c2.vtrnno,
    COALESCE(
      NULLIF(btrim(m.cancel_reason), ''),
      NULLIF(btrim(h.cancel_reason), '')
    ) AS cancel_reason,
    COALESCE(
      NULLIF(btrim(m.item_code), ''),
      NULLIF(btrim(h.item_code), '')
    ) AS item_code,
    NULLIF(btrim(fo.vsapvendorcode), '') AS franchisee_vendor_code
  FROM calls_cancelled c2
  LEFT JOIN calls_crm_mirror m ON m.vtrnno = c2.vtrnno
  LEFT JOIN calls_latest_hot h ON h.vtrnno = c2.vtrnno
  LEFT JOIN dim_offices fo ON fo.ncode = (
    CASE
      WHEN btrim(COALESCE(m.franchisee_code, h.franchisee_code, '')) ~ '^[0-9]+$'
      THEN btrim(COALESCE(m.franchisee_code, h.franchisee_code))::bigint
      ELSE NULL
    END
  )
) src
WHERE c.vtrnno = src.vtrnno
  AND (
    c.cancel_reason IS DISTINCT FROM src.cancel_reason
    OR c.item_code IS DISTINCT FROM src.item_code
    OR c.franchisee_vendor_code IS DISTINCT FROM src.franchisee_vendor_code
  );

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_date_ist
  ON calls_cancelled (cancelled_date_ist DESC);

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_office_date_ist
  ON calls_cancelled (nofficeid, cancelled_date_ist DESC);

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_vendor_date_ist
  ON calls_cancelled (franchisee_vendor_code, cancelled_date_ist DESC)
  WHERE franchisee_vendor_code IS NOT NULL AND btrim(franchisee_vendor_code) <> '';

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_branch_date_ist
  ON calls_cancelled (upper(btrim(branch_name)), cancelled_date_ist DESC)
  WHERE coalesce(btrim(branch_name), '') <> '';

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_account_date_ist
  ON calls_cancelled (upper(btrim(account)), cancelled_date_ist DESC)
  WHERE coalesce(btrim(account), '') <> ''
    AND upper(btrim(account)) <> 'UNCLASSIFIED';

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_call_type_date_ist
  ON calls_cancelled (upper(btrim(call_type)), cancelled_date_ist DESC)
  WHERE coalesce(btrim(call_type), '') <> '';

COMMENT ON COLUMN calls_cancelled.cancelled_date_ist IS
  'IST calendar date of cancelled_at — used for report date-range filters (indexed).';
