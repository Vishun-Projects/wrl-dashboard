-- Chunk 33: CRM msduserlocation mirror (GPS / travel pings per user).
-- Join to attendance via user_id (= nuser) and/or trn_no / addedon day.
-- SAFE: additive only. Does not modify Western CRM.

CREATE TABLE IF NOT EXISTS crm_user_locations (
  ncode            bigint PRIMARY KEY,
  user_id          numeric,
  office_id        bigint,
  latlong          text,
  added_on         timestamptz,
  added_on_raw     text,
  acode            text,
  action_type      text,
  distance         numeric,
  trn_ncode        bigint,
  trn_no           text,
  customer_name    text,
  travel_mode      text,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_user_locations_added_on
  ON crm_user_locations (added_on DESC);

CREATE INDEX IF NOT EXISTS idx_crm_user_locations_user_added
  ON crm_user_locations (user_id, added_on DESC);

CREATE INDEX IF NOT EXISTS idx_crm_user_locations_office_added
  ON crm_user_locations (office_id, added_on DESC);

CREATE INDEX IF NOT EXISTS idx_crm_user_locations_trn_no
  ON crm_user_locations (trn_no)
  WHERE trn_no IS NOT NULL AND trn_no <> '';

COMMENT ON TABLE crm_user_locations IS
  'Mirror of CRM msduserlocation (user GPS / travel location pings). user_id = nuser (numeric, may be fractional).';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('crm_user_locations', NULL, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE crm_user_locations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE crm_user_locations FROM authenticated;
  END IF;
END $$;
