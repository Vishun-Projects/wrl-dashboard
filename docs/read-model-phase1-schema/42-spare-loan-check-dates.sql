-- Chunk 42: call logged / last edited timestamps on spare loan problem rows.

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS call_logged_at timestamptz;

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_spare_loan_check_rows_logged
  ON spare_loan_check_rows (call_logged_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_spare_loan_check_rows_edited
  ON spare_loan_check_rows (last_edited_at DESC NULLS LAST);
