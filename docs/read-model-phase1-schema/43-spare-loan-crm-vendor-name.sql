-- Chunk 43: CRM vendor name on spare loan problem rows.

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS crm_vendor_name text;
