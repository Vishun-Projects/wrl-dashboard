-- Compressor barcodes tracking table
CREATE TABLE IF NOT EXISTS compressor_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL,
  call_no TEXT NOT NULL,
  call_date TIMESTAMPTZ NOT NULL,
  office_name TEXT,
  derived_old_barcode TEXT,
  derived_new_barcode TEXT,
  call_status TEXT NOT NULL DEFAULT 'Closed',
  cancel_reason TEXT,
  is_continuity_broken BOOLEAN NOT NULL DEFAULT false,
  expected_old_barcode TEXT,
  branch_name TEXT,
  sap_vendor_code TEXT,
  old_item_code TEXT,
  old_item_name TEXT,
  new_item_code TEXT,
  new_item_name TEXT,
  solve_date TIMESTAMPTZ,
  days_gap INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compressor_barcodes_serial_call_uq UNIQUE (serial_number, call_no)
);

CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_serial ON compressor_barcodes (serial_number);
CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_call_date ON compressor_barcodes (call_date);
CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_solve_date ON compressor_barcodes (solve_date);
CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_call_no ON compressor_barcodes (call_no);
CREATE INDEX IF NOT EXISTS idx_compressor_barcodes_broken ON compressor_barcodes (is_continuity_broken) WHERE is_continuity_broken = true;
