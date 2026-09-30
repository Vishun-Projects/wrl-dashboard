-- Provision date filter: Branch Call Approved = arcp_lines_hot.source_editedon
-- (CRM tdcalls10arcp.editedon, already synced on every line).

CREATE INDEX IF NOT EXISTS idx_arcp_hot_source_editedon
  ON arcp_lines_hot (source_editedon DESC)
  WHERE source_editedon IS NOT NULL AND is_rejected = false;
