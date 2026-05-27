-- Chunk 2: enums (idempotent)
DO $$ BEGIN
  CREATE TYPE status_bucket_type AS ENUM (
    'open_unallocated',
    'assigned',
    'tech_solved',
    'solved',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sync_batch_status AS ENUM (
    'started',
    'completed',
    'partial',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sync_run_status AS ENUM (
    'started',
    'completed',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
