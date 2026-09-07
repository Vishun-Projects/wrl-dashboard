-- Chunk 45: SAP plant display name + zone on spare loan problem rows.

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS plant_name text;

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS zone text;
