-- Chunk 1: extensions (requires superuser on some hosts; Supabase allows pg_stat_statements)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
