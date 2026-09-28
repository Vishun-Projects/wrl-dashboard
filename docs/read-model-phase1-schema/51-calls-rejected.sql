-- Chunk 51: currently rejected trhcalls (HO / Branch Manager).
-- Source flags: bhoreject (minus bhounreject) and bBMreject.
-- SAFE: additive only. Does not modify Western CRM.

CREATE TABLE IF NOT EXISTS calls_rejected (
  ncode                bigint NOT NULL,
  nofficeid            bigint NOT NULL,
  call_no              text NOT NULL,
  call_date            timestamptz,
  serial_no            text,
  call_type            text,
  activity_done        text,
  solve_date           timestamptz,
  rejected_by_source   text NOT NULL,
  rejection_at         timestamptz,
  rejection_reason     text,
  rejected_by_name     text,
  branch_name          text,
  franchisee_name      text,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ncode, nofficeid)
);

CREATE INDEX IF NOT EXISTS idx_calls_rejected_at
  ON calls_rejected (rejection_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_rejected_source_at
  ON calls_rejected (rejected_by_source, rejection_at DESC);

COMMENT ON TABLE calls_rejected IS
  'Currently rejected calls from trhcalls. HO = bhoreject and not bhounreject; Branch = bBMreject.';

INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), 'page_rejected_calls',
  'Calls rejected by HO or Branch Manager, with reject reasons from trhcalls'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_permissions WHERE name = 'page_rejected_calls'
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE calls_rejected FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE calls_rejected FROM authenticated;
  END IF;
END $$;
