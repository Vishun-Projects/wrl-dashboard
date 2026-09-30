-- Chunk 55: ZSS02 spare-parts ledger — append-only imports (re-upload keeps history).

CREATE TABLE IF NOT EXISTS zss02_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name             text NOT NULL,
  uploaded_by           uuid,
  parsed                integer NOT NULL DEFAULT 0,
  skipped               integer NOT NULL DEFAULT 0,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zss02_imports IS
  'ZSS02 HTML upload batches. Re-upload overwrites rows for plants present in the file.';

CREATE TABLE IF NOT EXISTS zss02_rows (
  id                    bigserial PRIMARY KEY,
  import_id             uuid NOT NULL REFERENCES zss02_imports(id) ON DELETE CASCADE,
  plant                 text NOT NULL,
  vendor_no             text NOT NULL DEFAULT '',
  vendor_name           text NOT NULL DEFAULT '',
  material              text NOT NULL DEFAULT '',
  material_description  text NOT NULL DEFAULT '',
  barcode               text NOT NULL DEFAULT '',
  so_con_rtn            text NOT NULL DEFAULT '',
  so_loan               text NOT NULL DEFAULT '',
  loan_date             text NOT NULL DEFAULT '',
  loan_rtn_date         text NOT NULL DEFAULT '',
  cnsmp_date            text NOT NULL DEFAULT '',
  no_cnsmp_count        text NOT NULL DEFAULT '',
  sale_date             text NOT NULL DEFAULT '',
  sale_rtn_date         text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_import_id
  ON zss02_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_plant
  ON zss02_rows (plant);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_vendor_no
  ON zss02_rows (vendor_no);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_material
  ON zss02_rows (material);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_barcode
  ON zss02_rows (barcode);

CREATE INDEX IF NOT EXISTS idx_zss02_rows_loan_date
  ON zss02_rows (loan_date);

COMMENT ON TABLE zss02_rows IS
  'Full ZSS02 ALV rows as imported from SAP HTML (text cells as-is).';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_zss02',
  'Upload SAP ZSS02 HTML and browse spare loan / consumption rows as-is'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_zss02'
);
