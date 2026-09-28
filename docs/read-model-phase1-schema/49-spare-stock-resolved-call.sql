-- Chunk 49: resolved call number extracted from MB51 Text (register-checked).

ALTER TABLE spare_stock_movements
  ADD COLUMN IF NOT EXISTS resolved_call_no text;

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_resolved_call_no
  ON spare_stock_movements (resolved_call_no);
