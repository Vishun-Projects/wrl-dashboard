-- Chunk 44: CRM item category (mstitemcategory) on spare loan problem rows.

ALTER TABLE spare_loan_check_rows
  ADD COLUMN IF NOT EXISTS item_category text;
