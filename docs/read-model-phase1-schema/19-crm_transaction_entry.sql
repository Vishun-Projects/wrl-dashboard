-- Chunk 19: CRM TransactionEntry mirror for Call Register / Deployment Completion
-- Serials synced from Western CRM. Billing date = WarrantyStartDate (see chunk 23).
-- daddedon = CRM upload/import time (sync window).

CREATE TABLE IF NOT EXISTS crm_transaction_entry (
  client              text NOT NULL,
  product_serial_no   text NOT NULL,
  daddedon_raw        text,
  daddedon            timestamptz,
  unique_id           text,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  warranty_start_raw  text,
  warranty_start      timestamptz,
  PRIMARY KEY (client, product_serial_no)
);

CREATE INDEX IF NOT EXISTS idx_crm_txn_daddedon
  ON crm_transaction_entry (daddedon);

CREATE INDEX IF NOT EXISTS idx_crm_txn_client_daddedon
  ON crm_transaction_entry (client, daddedon);

CREATE INDEX IF NOT EXISTS idx_crm_txn_warranty_start
  ON crm_transaction_entry (warranty_start);

CREATE INDEX IF NOT EXISTS idx_crm_txn_client_warranty_start
  ON crm_transaction_entry (client, warranty_start);

COMMENT ON TABLE crm_transaction_entry IS
  'Mirror of CRM TransactionEntry (serial + WarrantyStartDate billing) for Call Register. Synced by sync-worker:transaction-entry.';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('crm_transaction_entry', NULL, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;
