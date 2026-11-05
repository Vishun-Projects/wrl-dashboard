-- Chunk 69: materialized warranty claim facts (Call Register ∩ ARCP ∩ MB51).
-- Populated by superadmin Resync; Claims tab / rates read from this table only.

CREATE TABLE IF NOT EXISTS warranty_claim_facts (
  claim_no                  text PRIMARY KEY,
  ncode                     bigint NOT NULL DEFAULT 0,
  serial_number             text NOT NULL DEFAULT '',
  claim_date                date,
  defect_description        text NOT NULL DEFAULT '',
  repair_cost               numeric(14,2) NOT NULL DEFAULT 0,
  traveling_reimbursement   numeric(14,2) NOT NULL DEFAULT 0,
  spare_parts_cost          numeric(14,2) NOT NULL DEFAULT 0,
  total_cost                numeric(14,2) NOT NULL DEFAULT 0,
  unit_id                   bigint REFERENCES warranty_provision_rows(id) ON DELETE SET NULL,
  match_status              text NOT NULL DEFAULT 'unmatched',
  material_group            text NOT NULL DEFAULT '',
  warranty_start            date,
  warranty_end_date         date,
  synced_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_date
  ON warranty_claim_facts (claim_date DESC NULLS LAST, ncode DESC);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_serial
  ON warranty_claim_facts (serial_number);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_match
  ON warranty_claim_facts (match_status);

CREATE INDEX IF NOT EXISTS idx_warranty_claim_facts_material_group
  ON warranty_claim_facts (material_group)
  WHERE match_status = 'matched';

CREATE TABLE IF NOT EXISTS warranty_claim_facts_meta (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  synced_at   timestamptz,
  row_count   integer NOT NULL DEFAULT 0,
  synced_by   text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO warranty_claim_facts_meta (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE warranty_claim_facts IS
  'Processed warranty claims (register + ARCP + MB51). Refreshed by Claims Resync.';
