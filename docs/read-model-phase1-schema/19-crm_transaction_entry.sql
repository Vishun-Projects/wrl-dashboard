-- Chunk 19: CRM TransactionEntry mirror for Call Register / Deployment Completion
-- Billing serials (Client, ProductSerialNo, daddedon) synced from Western CRM.

CREATE TABLE IF NOT EXISTS crm_transaction_entry (
  client              text NOT NULL,
  product_serial_no   text NOT NULL,
  daddedon_raw        text,
  daddedon            timestamptz,
  unique_id           text,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client, product_serial_no)
);

CREATE INDEX IF NOT EXISTS idx_crm_txn_daddedon
  ON crm_transaction_entry (daddedon);

CREATE INDEX IF NOT EXISTS idx_crm_txn_client_daddedon
  ON crm_transaction_entry (client, daddedon);

COMMENT ON TABLE crm_transaction_entry IS
  'Mirror of CRM TransactionEntry (serial + billing date) for Call Register. Synced by sync-worker:transaction-entry.';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('crm_transaction_entry', NULL, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;
