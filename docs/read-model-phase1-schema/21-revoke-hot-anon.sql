-- 21-revoke-hot-anon.sql
-- Remediation B1: hot tables are server SQL only (pg / service role).
-- Stopgap: revoke PostgREST roles so anon/authenticated cannot SELECT via API.
-- Apply with read-model schema apply scripts.
-- B2 follow-up: ENABLE ROW LEVEL SECURITY + policies, or permanently accept revoke-only.

CREATE OR REPLACE FUNCTION _remediation_revoke_hot_anon(tbl text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(tbl) IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon', tbl);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('REVOKE ALL ON TABLE %s FROM authenticated', tbl);
  END IF;
END;
$$;

SELECT _remediation_revoke_hot_anon('public.calls_latest_hot');
SELECT _remediation_revoke_hot_anon('public.arcp_lines_hot');
SELECT _remediation_revoke_hot_anon('public.call_metrics_daily');
SELECT _remediation_revoke_hot_anon('public.sync_state');
SELECT _remediation_revoke_hot_anon('public.sync_run_log');
SELECT _remediation_revoke_hot_anon('public.dim_office');
SELECT _remediation_revoke_hot_anon('public.dim_engineer');
SELECT _remediation_revoke_hot_anon('public.dim_item');
SELECT _remediation_revoke_hot_anon('public.mis_client_import_batches');
SELECT _remediation_revoke_hot_anon('public.mis_client_import_rows');
SELECT _remediation_revoke_hot_anon('public.mis_client_import_upload_chunks');
SELECT _remediation_revoke_hot_anon('public.mis_client_sources');

DROP FUNCTION IF EXISTS _remediation_revoke_hot_anon(text);
