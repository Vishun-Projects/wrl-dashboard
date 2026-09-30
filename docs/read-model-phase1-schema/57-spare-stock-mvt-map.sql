-- Chunk 57: editable movement-type map + debit/credit blank-location clean view.

CREATE TABLE IF NOT EXISTS spare_stock_mvt_map (
  mvt     text PRIMARY KEY,
  kind    text NOT NULL CHECK (kind IN ('opening', 'issued', 'receipt', 'consumption')),
  effect  smallint NOT NULL CHECK (effect IN (-1, 1))
);

COMMENT ON TABLE spare_stock_mvt_map IS
  'MB51 movement types → stock kind/effect. Edit rows here; report joins this map.';

INSERT INTO spare_stock_mvt_map (mvt, kind, effect) VALUES
  ('561', 'opening', 1),
  ('941', 'issued', 1),
  ('942', 'issued', 1),
  ('801', 'issued', 1),
  ('802', 'issued', 1),
  ('945', 'receipt', -1),
  ('946', 'receipt', -1),
  ('951', 'receipt', -1),
  ('952', 'receipt', -1),
  ('853', 'receipt', -1),
  ('854', 'receipt', -1),
  ('943', 'consumption', -1),
  ('944', 'consumption', -1),
  ('947', 'consumption', -1),
  ('948', 'consumption', -1),
  ('949', 'consumption', -1)
ON CONFLICT (mvt) DO UPDATE
SET kind = EXCLUDED.kind,
    effect = EXCLUDED.effect;

-- Rule 3: when plant+mat_doc+material+abs(qty)+mvt has both debit and credit,
-- keep only blank storage-location rows.
CREATE OR REPLACE VIEW spare_stock_mvt_clean AS
WITH tagged AS (
  SELECT
    m.row_key,
    m.import_id,
    m.plant,
    m.mat_doc,
    m.doc_date,
    m.posting_date,
    m.material,
    m.material_description,
    m.location,
    m.uom,
    m.qty,
    m.lc_amount,
    m.mvt,
    m.mvt_text,
    m.txn_type,
    m.batch,
    m.entry_date,
    m.entry_time,
    m.sap_user,
    m.material_group,
    m.customer,
    m.header_text,
    m.call_no,
    m.mat_yr,
    m.order_no,
    m.supplier,
    BOOL_OR(m.qty > 0) OVER w AS has_pos,
    BOOL_OR(m.qty < 0) OVER w AS has_neg
  FROM spare_stock_movements m
  WINDOW w AS (
    PARTITION BY m.plant, m.mat_doc, m.material, ABS(m.qty), m.mvt
  )
)
SELECT
  row_key,
  import_id,
  plant,
  mat_doc,
  doc_date,
  posting_date,
  material,
  material_description,
  location,
  uom,
  qty,
  lc_amount,
  mvt,
  mvt_text,
  txn_type,
  batch,
  entry_date,
  entry_time,
  sap_user,
  material_group,
  customer,
  header_text,
  call_no,
  mat_yr,
  order_no,
  supplier
FROM tagged
WHERE NOT (has_pos AND has_neg)
   OR NULLIF(TRIM(COALESCE(location, '')), '') IS NULL;
