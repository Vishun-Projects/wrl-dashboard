-- WRL call number (trdcalls2fault.ncalls) for SAP-aligned dedupe
ALTER TABLE arcp_lines_hot
  ADD COLUMN IF NOT EXISTS call_no varchar(50);

CREATE INDEX IF NOT EXISTS idx_arcp_hot_call_no
  ON arcp_lines_hot (call_no)
  WHERE call_no IS NOT NULL AND TRIM(call_no) <> '';
