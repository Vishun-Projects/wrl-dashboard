-- Chunk 32: full CRM calls mirror (all statuses except transfers).
-- Independent of calls_latest_hot retention. PK = vtrnno.
-- SAFE: additive only. Does not modify Western CRM or calls_latest_hot.

CREATE TABLE IF NOT EXISTS calls_crm_mirror (
  ncode                 bigint NOT NULL,
  vtrnno                varchar(50) NOT NULL,
  vcclid                varchar(50),
  nofficeid             bigint NOT NULL,
  nengineer             bigint,
  office_under          bigint,
  franchisee_code       varchar(50),
  party_name            text,
  branch_name           varchar(255),
  franchisee_name       varchar(255),
  pincode               varchar(20),
  city                  varchar(255),
  state                 varchar(100),
  region                varchar(100) NOT NULL DEFAULT 'OTHER',
  account               varchar(255) NOT NULL DEFAULT 'UNCLASSIFIED',
  item_name             varchar(255),
  serial                varchar(100),
  wco                   varchar(1),
  engineer_name         varchar(255),
  call_type             varchar(100),
  complaint             text,
  status_label          varchar(50),
  status_bucket         status_bucket_type NOT NULL,
  solve_remarks         text,
  contact_person        varchar(255),
  phone                 varchar(50),
  address               text,
  has_visit             boolean NOT NULL DEFAULT false,
  is_major              boolean NOT NULL DEFAULT false,
  is_part_pending       boolean NOT NULL DEFAULT false,
  branch_headcount      integer NOT NULL DEFAULT 0,
  logged_at             timestamptz NOT NULL,
  solved_at             timestamptz,
  edited_at             timestamptz,
  added_at              timestamptz,
  source_editedon       timestamptz,
  bsolved               boolean,
  bfastclose            boolean,
  bapproval             boolean,
  bm_approved_at        timestamptz,
  arcp_bm_approved_at   timestamptz,
  ncancelreason         integer,
  cancel_reason         text,
  cancelled_at          timestamptz,
  lat                   double precision,
  lng                   double precision,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_crm_mirror_pkey PRIMARY KEY (vtrnno)
);

CREATE INDEX IF NOT EXISTS idx_calls_mirror_logged_at
  ON calls_crm_mirror (logged_at DESC, ncode DESC);

CREATE INDEX IF NOT EXISTS idx_calls_mirror_source_editedon
  ON calls_crm_mirror (source_editedon DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_calls_mirror_cancelled_at
  ON calls_crm_mirror (cancelled_at DESC)
  WHERE cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_mirror_status_logged
  ON calls_crm_mirror (status_bucket, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_mirror_call_type_logged
  ON calls_crm_mirror (call_type, logged_at DESC);

COMMENT ON TABLE calls_crm_mirror IS
  'Full CRM trhcalls mirror (open/closed/cancelled/solved). Excludes transfers and empty TRN. Synced by editedon watermark; independent of calls_latest_hot.';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('calls_crm_mirror', '1970-01-01'::timestamptz, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE calls_crm_mirror FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE calls_crm_mirror FROM authenticated;
  END IF;
END $$;
