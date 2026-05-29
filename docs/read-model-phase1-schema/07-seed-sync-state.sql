-- Chunk 7: seed sync_state (idempotent)
INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('calls_latest_hot', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill'),
  ('call_metrics_daily', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill'),
  ('arcp_lines_hot', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill'),
  ('dim_offices', NULL, NULL, 'pending_backfill'),
  ('dim_engineers', NULL, NULL, 'pending_backfill'),
  ('dim_call_types', NULL, NULL, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;
