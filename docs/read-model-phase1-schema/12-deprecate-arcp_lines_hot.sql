-- arcp_lines_hot is deprecated: ARCP Claims reads live CRM (trhcalls + trdcalls10ARCP).
-- BM dates belong on calls_latest_hot (11-calls_hot_bm_approval.sql), not ARCP line dates.
-- Stop setting SYNC_ARCP_ENABLED=true. Optional: drop arcp_lines_hot only after backup.
--
-- SAFE: this script does NOT touch calls_latest_hot or CRM trhcalls.

COMMENT ON TABLE arcp_lines_hot IS
  'DEPRECATED — do not sync. ARCP Claims uses live Western CRM. Register BM dates use calls_latest_hot.bm_approved_at.';

-- Uncomment only after backup and confirming no dependency on arcp_lines_hot:
-- DROP TABLE IF EXISTS arcp_lines_hot CASCADE;
-- DELETE FROM sync_state WHERE entity = 'arcp_lines_hot';
