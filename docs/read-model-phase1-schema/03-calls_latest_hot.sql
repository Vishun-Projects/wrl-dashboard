-- Chunk 3: calls_latest_hot + indexes
CREATE TABLE IF NOT EXISTS calls_latest_hot (
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
  ncancelreason         integer,
  lat                   double precision,
  lng                   double precision,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calls_latest_hot_pkey PRIMARY KEY (vtrnno)
);

CREATE INDEX IF NOT EXISTS idx_calls_hot_logged_at
  ON calls_latest_hot (logged_at DESC, ncode DESC);

CREATE INDEX IF NOT EXISTS idx_calls_hot_status_logged
  ON calls_latest_hot (status_bucket, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_hot_office_logged
  ON calls_latest_hot (nofficeid, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_hot_call_type_logged
  ON calls_latest_hot (call_type, logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_hot_engineer_logged
  ON calls_latest_hot (nengineer, logged_at DESC)
  WHERE nengineer IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_hot_ncode
  ON calls_latest_hot (ncode);

CREATE INDEX IF NOT EXISTS idx_calls_hot_serial
  ON calls_latest_hot (serial);

COMMENT ON TABLE calls_latest_hot IS
  'Phase 1 hot read model: latest deduped call per vtrnno, 90d window + open-old exception.';
