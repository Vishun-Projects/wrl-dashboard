-- Chunk 48: SAP MB51 spare stock analysis — append/merge ledger + import meta.

CREATE TABLE IF NOT EXISTS spare_stock_imports (
  id                    bigserial PRIMARY KEY,
  file_name             text NOT NULL,
  uploaded_by           uuid,
  parsed                integer NOT NULL DEFAULT 0,
  inserted              integer NOT NULL DEFAULT 0,
  duplicates            integer NOT NULL DEFAULT 0,
  skipped               integer NOT NULL DEFAULT 0,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE spare_stock_imports IS
  'MB51 .htm upload batches. Movements append; duplicates skipped by row_key.';

CREATE TABLE IF NOT EXISTS spare_stock_movements (
  row_key               text PRIMARY KEY,
  import_id             bigint NOT NULL REFERENCES spare_stock_imports(id),
  plant                 text NOT NULL,
  mat_doc               text,
  doc_date              date,
  posting_date          date NOT NULL,
  material              text,
  material_description  text,
  location              text,
  uom                   text,
  qty                   numeric NOT NULL DEFAULT 0,
  lc_amount             numeric,
  mvt                   text NOT NULL,
  mvt_text              text,
  txn_type              text NOT NULL,
  batch                 text,
  entry_date            date,
  entry_time            text,
  sap_user              text,
  material_group        text,
  customer              text,
  header_text           text,
  call_no               text,
  mat_yr                text,
  order_no              text,
  supplier              text
);

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_posting_date
  ON spare_stock_movements (posting_date);

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_plant
  ON spare_stock_movements (plant);

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_material
  ON spare_stock_movements (material);

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_supplier
  ON spare_stock_movements (supplier);

CREATE INDEX IF NOT EXISTS idx_spare_stock_movements_txn_type
  ON spare_stock_movements (txn_type);

COMMENT ON TABLE spare_stock_movements IS
  'MB51 material movements. row_key fingerprints plant|mat_doc|mat_yr|material|mvt|posting_date|qty|location|supplier|call_no|entry_date|entry_time|batch.';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_spare_stock_analysis',
  'Upload SAP MB51 HTML and view spare stock opening, receipts, issues, and consumption'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_spare_stock_analysis'
);
