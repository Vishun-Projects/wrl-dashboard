-- Chunk 28: cancelled calls keyed by cancel datetime (trhcalls.editedon).
-- Real cancel = ncancelreason NOT IN (0, 2). ncancelreason 2 = transfer (excluded).
-- cancelled_at = last trhcalls.editedon — that stamp is the cancel datetime.
-- Independent of calls_latest_hot retention so pre-YTD cancels can live here.
-- SAFE: additive only. Does not modify Western CRM.

CREATE TABLE IF NOT EXISTS calls_cancelled (
  vtrnno              varchar(50) PRIMARY KEY,
  ncode               bigint NOT NULL,
  ncancelreason       integer NOT NULL,
  cancelled_at        timestamptz NOT NULL,
  logged_at           timestamptz NOT NULL,
  call_type           varchar(100),
  nofficeid           bigint NOT NULL,
  office_under        bigint,
  party_name          text,
  branch_name         varchar(255),
  franchisee_name     varchar(255),
  region              varchar(100) NOT NULL DEFAULT 'OTHER',
  account             varchar(255) NOT NULL DEFAULT 'UNCLASSIFIED',
  item_name           varchar(255),
  serial              varchar(100),
  engineer_name       varchar(255),
  complaint           text,
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_at
  ON calls_cancelled (cancelled_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_call_type_at
  ON calls_cancelled (call_type, cancelled_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_cancelled_office_at
  ON calls_cancelled (nofficeid, cancelled_at DESC);

COMMENT ON TABLE calls_cancelled IS
  'Cancelled trhcalls rows. cancelled_at = last editedon (cancel datetime). Excludes transfer (ncancelreason = 2).';

COMMENT ON COLUMN calls_cancelled.cancelled_at IS
  'trhcalls.editedon on the cancelled row — treated as cancelled-on datetime.';

INSERT INTO calls_cancelled (
  vtrnno, ncode, ncancelreason, cancelled_at, logged_at, call_type,
  nofficeid, office_under, party_name, branch_name, franchisee_name,
  region, account, item_name, serial, engineer_name, complaint, synced_at
)
SELECT
  h.vtrnno,
  h.ncode,
  COALESCE(h.ncancelreason, 0),
  COALESCE(h.edited_at, h.source_editedon, h.logged_at),
  h.logged_at,
  h.call_type,
  h.nofficeid,
  h.office_under,
  h.party_name,
  h.branch_name,
  h.franchisee_name,
  h.region,
  h.account,
  h.item_name,
  h.serial,
  h.engineer_name,
  h.complaint,
  now()
FROM calls_latest_hot h
WHERE COALESCE(h.ncancelreason, 0) NOT IN (0, 2)
   OR h.status_bucket = 'cancelled'
ON CONFLICT (vtrnno) DO UPDATE SET
  ncode = EXCLUDED.ncode,
  ncancelreason = EXCLUDED.ncancelreason,
  cancelled_at = EXCLUDED.cancelled_at,
  logged_at = EXCLUDED.logged_at,
  call_type = EXCLUDED.call_type,
  nofficeid = EXCLUDED.nofficeid,
  office_under = EXCLUDED.office_under,
  party_name = EXCLUDED.party_name,
  branch_name = EXCLUDED.branch_name,
  franchisee_name = EXCLUDED.franchisee_name,
  region = EXCLUDED.region,
  account = EXCLUDED.account,
  item_name = EXCLUDED.item_name,
  serial = EXCLUDED.serial,
  engineer_name = EXCLUDED.engineer_name,
  complaint = EXCLUDED.complaint,
  synced_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE calls_cancelled FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE calls_cancelled FROM authenticated;
  END IF;
END $$;
