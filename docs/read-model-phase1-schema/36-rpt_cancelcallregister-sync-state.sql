-- CRM rpt_cancelcallregister → calls_cancelled (/report/cancelled-calls). Filled from calls_crm_mirror when ready.
INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('rpt_cancelcallregister', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;

COMMENT ON TABLE calls_cancelled IS
  'Cancelled calls for /report/cancelled-calls. Filled from calls_crm_mirror (or hot fallback) by cancelled-register sync.';
