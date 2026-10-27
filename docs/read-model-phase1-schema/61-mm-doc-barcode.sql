-- Chunk 61: MM Document–wise barcode (Object Description) import for Parts Consumption

CREATE TABLE IF NOT EXISTS mm_doc_barcode_imports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name             text NOT NULL,
  uploaded_by           uuid,
  row_count             integer NOT NULL DEFAULT 0,
  imported_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mm_doc_barcode_imports IS
  'MM Document wise Barcode import batches (latest used for SAP barcode match).';

CREATE TABLE IF NOT EXISTS mm_doc_barcode_rows (
  id                    bigserial PRIMARY KEY,
  import_id             uuid NOT NULL REFERENCES mm_doc_barcode_imports(id) ON DELETE CASCADE,
  plant                 text NOT NULL DEFAULT '',
  storage_location      text NOT NULL DEFAULT '',
  material_document     text NOT NULL DEFAULT '',
  posting_date          date,
  material              text NOT NULL DEFAULT '',
  object_description    text NOT NULL DEFAULT '',
  movement_type         text NOT NULL DEFAULT '',
  seq_order             integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mm_doc_barcode_rows_import_id
  ON mm_doc_barcode_rows (import_id);

CREATE INDEX IF NOT EXISTS idx_mm_doc_barcode_rows_doc_material
  ON mm_doc_barcode_rows (import_id, material_document, material);

COMMENT ON TABLE mm_doc_barcode_rows IS
  'Object Description (barcode) per Material Document + Material from MM export.';
