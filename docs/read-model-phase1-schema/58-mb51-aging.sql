-- Chunk 58: MB51 Material Aging Report (FIFO) storage

CREATE TABLE IF NOT EXISTS mb51_aging_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name             text NOT NULL,
  uploaded_by           uuid,
  row_count             integer NOT NULL DEFAULT 0,
  plant_count           integer NOT NULL DEFAULT 0,
  material_count        integer NOT NULL DEFAULT 0,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mb51_aging_imports IS
  'MB51 Aging Report import batches.';

CREATE TABLE IF NOT EXISTS mb51_aging_rows (
  id                    bigserial PRIMARY KEY,
  import_id             uuid NOT NULL REFERENCES mb51_aging_imports(id) ON DELETE CASCADE,
  posting_date_serial   integer NOT NULL,
  posting_date          date NOT NULL,
  qty                   numeric(18, 3) NOT NULL DEFAULT 0,
  material              text NOT NULL DEFAULT '',
  material_description  text NOT NULL DEFAULT '',
  material_group        text NOT NULL DEFAULT '',
  uom                   text NOT NULL DEFAULT '',
  vendor                text NOT NULL DEFAULT '',
  vendor_name           text NOT NULL DEFAULT '',
  plant                 text NOT NULL DEFAULT '',
  material_document     text NOT NULL DEFAULT '',
  movement_type         text NOT NULL DEFAULT '',
  movement_type_text    text NOT NULL DEFAULT '',
  item_text             text NOT NULL DEFAULT '',
  seq_order             integer NOT NULL DEFAULT 0
);

ALTER TABLE mb51_aging_rows
  ADD COLUMN IF NOT EXISTS item_text text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_import_id
  ON mb51_aging_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_import_seq
  ON mb51_aging_rows (import_id, seq_order);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_plant
  ON mb51_aging_rows (plant);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_material
  ON mb51_aging_rows (material);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_vendor
  ON mb51_aging_rows (vendor);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_date
  ON mb51_aging_rows (posting_date);

COMMENT ON TABLE mb51_aging_rows IS
  'MB51 movement records for FIFO aging calculation.';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_mb51_aging',
  'MB51 Material Aging Report (FIFO)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_mb51_aging'
);
