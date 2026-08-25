-- Chunk 2: enums (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_bucket_type') THEN
    CREATE TYPE status_bucket_type AS ENUM (
      'open_unallocated',
      'assigned',
      'tech_solved',
      'solved',
      'cancelled'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_batch_status') THEN
    CREATE TYPE sync_batch_status AS ENUM (
      'started',
      'completed',
      'partial',
      'failed'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_run_status') THEN
    CREATE TYPE sync_run_status AS ENUM (
      'started',
      'completed',
      'failed'
    );
  END IF;
END $$;
