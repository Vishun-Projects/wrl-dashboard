-- Chunk 66: Warranty Provision — standalone SAP .xlsb dump (flat table, no FKs).

-- Drop draft imports parent if an earlier attempt created it.
DROP TABLE IF EXISTS warranty_provision_imports CASCADE;

-- Rebuild rows once if the draft still has import_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'warranty_provision_rows'
      AND column_name = 'import_id'
  ) THEN
    DROP TABLE warranty_provision_rows CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS warranty_provision_rows (
  id                         bigserial PRIMARY KEY,
  billing_document           text NOT NULL DEFAULT '',
  billing_date               date,
  material                   text NOT NULL DEFAULT '',
  serial_number              text NOT NULL DEFAULT '',
  material_group             text NOT NULL DEFAULT '',
  external_material_group    text NOT NULL DEFAULT '',
  sold_to_party_name         text NOT NULL DEFAULT '',
  customer_subgroup          text NOT NULL DEFAULT '',
  ship_to_party_name         text NOT NULL DEFAULT '',
  ship_to_party_state        text NOT NULL DEFAULT '',
  ship_to_party_city         text NOT NULL DEFAULT '',
  inventory_number           text NOT NULL DEFAULT '',
  warranty_start             date,
  warranty_end_date          date,
  days                       integer,
  remaining_days             integer,
  warranty_remaining_days    text NOT NULL DEFAULT '',
  warranty_end_fy            text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_wp_rows_billing_date ON warranty_provision_rows (billing_date);
CREATE INDEX IF NOT EXISTS idx_wp_rows_material ON warranty_provision_rows (material);
CREATE INDEX IF NOT EXISTS idx_wp_rows_material_group ON warranty_provision_rows (material_group);
CREATE INDEX IF NOT EXISTS idx_wp_rows_customer_subgroup ON warranty_provision_rows (customer_subgroup);
CREATE INDEX IF NOT EXISTS idx_wp_rows_state ON warranty_provision_rows (ship_to_party_state);
CREATE INDEX IF NOT EXISTS idx_wp_rows_fy ON warranty_provision_rows (warranty_end_fy);
CREATE INDEX IF NOT EXISTS idx_wp_rows_remaining_label ON warranty_provision_rows (warranty_remaining_days);
CREATE INDEX IF NOT EXISTS idx_wp_rows_serial ON warranty_provision_rows (serial_number);

-- Drop sheet_name if an earlier import stored it (not needed in UI/DB).
DROP INDEX IF EXISTS idx_wp_rows_sheet;
ALTER TABLE warranty_provision_rows DROP COLUMN IF EXISTS sheet_name;

COMMENT ON TABLE warranty_provision_rows IS
  'Warranty Provision rows from SAP .xlsb. Standalone — no FKs.';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_warranty_provision',
  'Browse Warranty Provision workbook rows imported from SAP .xlsb'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_warranty_provision'
);
