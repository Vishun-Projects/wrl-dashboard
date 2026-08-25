-- Chunk 29: CRM uv_rptattandenceDetails_New2 mirror (attendance / work-done / expense lines).
-- Source is a denormalized report view: same ncode can appear on Attendance, service, and expense rows.
-- row_key = ncode|heading|uniquecall|inquiryno|nexpensetrnno|trnno|meeting stamps.
-- SAFE: additive only. Does not modify Western CRM.

CREATE TABLE IF NOT EXISTS crm_attendance_details (
  row_key                 text PRIMARY KEY,
  ncode                   bigint NOT NULL,
  heading                 text NOT NULL,
  activity_date           timestamptz,
  activity_date_raw       text,
  activity_day            text,
  office_name             text,
  attd_user               text,
  user_id                 bigint,
  office_id               bigint,
  attd_total_time         text,
  day_start               timestamptz,
  day_end                 timestamptz,
  start_latlong           text,
  end_latlong             text,
  city_start              text,
  city_end                text,
  sales_customer          text,
  sales_meeting_start     timestamptz,
  sales_meeting_end       timestamptz,
  sales_total_time        text,
  iqv_start_latlong       text,
  iqv_end_latlong         text,
  inquiry_no              text,
  mobile                  text,
  face_to_face            boolean,
  service_customer        text,
  unique_call             text,
  trn_no                  text,
  service_meeting_start   timestamptz,
  service_meeting_end     timestamptz,
  service_total_time      text,
  visit_start_latlong     text,
  visit_end_latlong       text,
  remote_support          boolean,
  travel_mode             text,
  travel_start            timestamptz,
  travel_end              timestamptz,
  travel_total_time       text,
  attend_start_latlong    text,
  attend_end_latlong      text,
  expense_no              text,
  expense_date            timestamptz,
  expense_type            text,
  expense_amt             numeric,
  remarks                 text,
  expense_trn_no          text,
  customer_name           text,
  customer_latlong        text,
  customer_address        text,
  synced_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_activity_date
  ON crm_attendance_details (activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_user_date
  ON crm_attendance_details (user_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_office_date
  ON crm_attendance_details (office_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_heading_date
  ON crm_attendance_details (heading, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_crm_attendance_unique_call
  ON crm_attendance_details (unique_call)
  WHERE unique_call IS NOT NULL AND unique_call <> '';

COMMENT ON TABLE crm_attendance_details IS
  'Mirror of CRM uv_rptattandenceDetails_New2 (attendance / service work-done / expense lines).';

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('crm_attendance_details', NULL, '1970-01-01'::timestamptz, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE crm_attendance_details FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE crm_attendance_details FROM authenticated;
  END IF;
END $$;
