-- Chunk 23: WarrantyStartDate as Call Register billing date
-- daddedon stays as CRM upload/import time (sync window). Billing UI uses warranty_start.

ALTER TABLE crm_transaction_entry
  ADD COLUMN IF NOT EXISTS warranty_start_raw text,
  ADD COLUMN IF NOT EXISTS warranty_start timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_txn_warranty_start
  ON crm_transaction_entry (warranty_start);

CREATE INDEX IF NOT EXISTS idx_crm_txn_client_warranty_start
  ON crm_transaction_entry (client, warranty_start);

COMMENT ON COLUMN crm_transaction_entry.warranty_start IS
  'CRM TransactionEntry.WarrantyStartDate — Call Register / Deployment Completion billing date';
COMMENT ON COLUMN crm_transaction_entry.daddedon IS
  'CRM TransactionEntry.daddedon (row upload/import time) — sync/verify window only';
COMMENT ON TABLE crm_transaction_entry IS
  'Mirror of CRM TransactionEntry (serial + WarrantyStartDate billing) for Call Register. Synced by sync-worker:transaction-entry.';
