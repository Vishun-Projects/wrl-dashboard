-- Chunk 62: Daily ops activity (dashboard trends)
-- Per IST day: logged / solved / tech_solved / cancelled event counts from hot.
-- open_unallocated column stores logged-that-day; assigned is unused (0).

CREATE TABLE IF NOT EXISTS ops_status_snapshot_daily (
  as_of_date          date NOT NULL,
  office_id           bigint NOT NULL,
  call_type           varchar(100) NOT NULL,
  open_unallocated    integer NOT NULL DEFAULT 0,
  assigned            integer NOT NULL DEFAULT 0,
  tech_solved         integer NOT NULL DEFAULT 0,
  solved              integer NOT NULL DEFAULT 0,
  cancelled           integer NOT NULL DEFAULT 0,
  total               integer NOT NULL DEFAULT 0,
  captured_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_status_snapshot_daily_pkey
    PRIMARY KEY (as_of_date, office_id, call_type)
);

CREATE INDEX IF NOT EXISTS idx_ops_status_snap_as_of
  ON ops_status_snapshot_daily (as_of_date);

CREATE INDEX IF NOT EXISTS idx_ops_status_snap_office_date
  ON ops_status_snapshot_daily (office_id, as_of_date);

COMMENT ON TABLE ops_status_snapshot_daily IS
  'Daily activity by office × call_type (IST): logged (open_unallocated col), solved, tech_solved, cancelled. Not portfolio stock. Sealed after midnight; range backfill from hot.';

COMMENT ON COLUMN ops_status_snapshot_daily.open_unallocated IS
  'Calls logged that IST day (inflow). Column name kept for compatibility.';

COMMENT ON COLUMN ops_status_snapshot_daily.assigned IS
  'Unused for activity trends (always 0).';
