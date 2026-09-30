-- SUPERSEDED: ARCP Claims / Provision read arcp_lines_hot with SYNC_ARCP_ENABLED
-- and READ_ARCP_FROM=postgres (3-minute daemon). Do NOT drop this table.
-- Historical note: an earlier cutover draft preferred live CRM; that path is retired
-- for VPS — keep the hot table warm and set ARCP_CRM_FALLBACK_ON_EMPTY=true only
-- when deliberately gap-filling from CRM.

COMMENT ON TABLE arcp_lines_hot IS
  'Franchise ARCP claim lines (nofficetype=3). Synced every SYNC_INTERVAL_MS when SYNC_ARCP_ENABLED=true. Claims + Provision read this when READ_ARCP_FROM=postgres.';
