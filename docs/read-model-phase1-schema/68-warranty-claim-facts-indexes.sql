-- Chunk 68: indexes for warranty Claims tab (Call Register ∩ ARCP ∩ MB51).

-- ARCP lookup by Service Order / call number (expression used in claim-facts).
CREATE INDEX IF NOT EXISTS idx_arcp_hot_vucnno_upper
  ON arcp_lines_hot (upper(btrim(vucnno)))
  WHERE NOT is_rejected AND NULLIF(btrim(vucnno), '') IS NOT NULL;

-- MB51 spare amount by Text (call number) within latest import.
CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_import_item_text_upper
  ON mb51_aging_rows (import_id, upper(btrim(item_text)))
  WHERE amt_in_loc_cur IS NOT NULL AND btrim(item_text) <> '';

-- Warranty unit serial join (hot calls → provision rows).
CREATE INDEX IF NOT EXISTS idx_wp_rows_serial_btrim
  ON warranty_provision_rows (serial_number)
  WHERE btrim(serial_number) <> '';
