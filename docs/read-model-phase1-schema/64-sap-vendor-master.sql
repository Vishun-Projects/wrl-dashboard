-- Chunk 64: SAP Vendor Master (Supplier / Name 1) for MB51 vendor-name lookup.

CREATE TABLE IF NOT EXISTS sap_vendor_master (
  vendor_code  text PRIMARY KEY,
  vendor_name  text NOT NULL DEFAULT '',
  valid_from   date,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sap_vendor_master_name
  ON sap_vendor_master (vendor_name);

COMMENT ON TABLE sap_vendor_master IS
  'SAP Vendor Master (Supplier code → Name 1). Used to fill MB51 SAP Vendor Name from vendor code.';
