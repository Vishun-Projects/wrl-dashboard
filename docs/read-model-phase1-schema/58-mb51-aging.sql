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

-- One line per fingerprint inside an import (append / re-upload must not double-count).
-- Keep the earliest row when duplicates already exist.
DELETE FROM mb51_aging_rows a
USING mb51_aging_rows b
WHERE a.import_id = b.import_id
  AND a.id > b.id
  AND a.material_document = b.material_document
  AND a.plant = b.plant
  AND a.material = b.material
  AND a.movement_type = b.movement_type
  AND a.posting_date_serial = b.posting_date_serial
  AND a.qty = b.qty
  AND a.vendor = b.vendor
  AND a.uom = b.uom
  AND a.item_text = b.item_text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mb51_aging_rows_import_dedupe
  ON mb51_aging_rows (
    import_id,
    material_document,
    plant,
    material,
    movement_type,
    posting_date_serial,
    qty,
    vendor,
    uom,
    item_text
  );

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_fifo_scan
  ON mb51_aging_rows (
    import_id, plant, vendor, material, uom, posting_date_serial, seq_order
  );

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_plant
  ON mb51_aging_rows (plant);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_material
  ON mb51_aging_rows (material);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_vendor
  ON mb51_aging_rows (vendor);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_date
  ON mb51_aging_rows (posting_date);

-- Parts Consumption SAP doc CTE / sap-doc lookup (filter by import + movement + material, skip blank item_text).
CREATE INDEX IF NOT EXISTS idx_mb51_aging_rows_sap_call_docs
  ON mb51_aging_rows (import_id, movement_type, material)
  WHERE btrim(item_text) <> '';

COMMENT ON TABLE mb51_aging_rows IS
  'MB51 movement records for FIFO aging calculation.';

-- Precomputed FIFO result for fast page open (KPIs + thin agg pages).
CREATE TABLE IF NOT EXISTS mb51_aging_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       uuid NOT NULL REFERENCES mb51_aging_imports(id) ON DELETE CASCADE,
  param_hash      text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count       integer NOT NULL DEFAULT 0,
  built_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, param_hash)
);

CREATE TABLE IF NOT EXISTS mb51_aging_agg_rows (
  id                    bigserial PRIMARY KEY,
  snapshot_id           uuid NOT NULL REFERENCES mb51_aging_snapshots(id) ON DELETE CASCADE,
  seq                   integer NOT NULL DEFAULT 0,
  group_key             text NOT NULL DEFAULT '',
  vendor                text NOT NULL DEFAULT '',
  vendor_name           text NOT NULL DEFAULT '',
  material_group        text NOT NULL DEFAULT '',
  material              text NOT NULL DEFAULT '',
  material_description  text NOT NULL DEFAULT '',
  uom                   text NOT NULL DEFAULT '',
  bk                    numeric(18, 3)[] NOT NULL DEFAULT ARRAY[]::numeric[],
  total                 numeric(18, 3) NOT NULL DEFAULT 0,
  full_qty              numeric(18, 3) NOT NULL DEFAULT 0,
  n                     integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_agg_snapshot_seq
  ON mb51_aging_agg_rows (snapshot_id, seq);

CREATE INDEX IF NOT EXISTS idx_mb51_aging_agg_snapshot_material
  ON mb51_aging_agg_rows (snapshot_id, material);

COMMENT ON TABLE mb51_aging_snapshots IS
  'Materialized FIFO aging summaries keyed by import + param hash.';

COMMENT ON TABLE mb51_aging_agg_rows IS
  'Thin FIFO aggregate rows for a snapshot (no movement layers).';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_mb51_aging',
  'MB51 Material Aging Report (FIFO)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_mb51_aging'
);
