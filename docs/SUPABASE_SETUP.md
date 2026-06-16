# Supabase Setup for FastClose

Run the following SQL in your Supabase SQL Editor to create the necessary tables and set up Row Level Security (RLS).

```sql
-- 1. App Users (Profiles)
CREATE TABLE app_users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('branch_manager', 'hod')),
  office_ids  TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Call Flags (Internal)
CREATE TABLE call_flags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      TEXT NOT NULL UNIQUE, -- trhcalls.ncode
  office_id    TEXT NOT NULL,         -- trhcalls.nofficeid
  flag_type    TEXT NOT NULL CHECK (flag_type IN ('noted', 'query', 'escalate')),
  set_by       UUID REFERENCES auth.users(id),
  set_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. Flag Audit Log (Append-only)
CREATE TABLE flag_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id       TEXT NOT NULL,
  office_id     TEXT NOT NULL,
  old_flag      TEXT,
  new_flag      TEXT,
  changed_by    UUID REFERENCES auth.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Call Comments (Internal)
CREATE TABLE call_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     TEXT NOT NULL,
  office_id   TEXT NOT NULL,
  comment     TEXT NOT NULL,
  author_id   UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_comments ENABLE ROW LEVEL SECURITY;

-- Policies for app_users
CREATE POLICY "Users can see all profiles" ON app_users FOR SELECT USING (true);
CREATE POLICY "HOD can manage all profiles" ON app_users FOR ALL USING (
  EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'hod')
);

-- Page-wise access permissions (assign in Roles & Access)
INSERT INTO public.app_permissions (id, name, description)
SELECT gen_random_uuid(), v.name, v.description
FROM (VALUES
  ('page_mis_reports', 'Access MIS Reports register, summary, and accounts'),
  ('page_call_distribution', 'Access Call Distribution map and KPIs'),
  ('page_arcp_claims', 'Access ARCP Claims register'),
  ('page_serial_audit', 'Access Serial Wise History audit'),
  ('page_location_audit', 'Access Location Audit'),
  ('page_warranty_master', 'Access Warranty Master dashboard')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM public.app_permissions p WHERE p.name = v.name);

CREATE POLICY "Users can update own report preferences" ON app_users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Policies for call_flags
CREATE POLICY "Users can see flags for their branches" ON call_flags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (role = 'hod' OR office_id = ANY(office_ids))
  )
);
CREATE POLICY "Users can set flags for their branches" ON call_flags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = auth.uid() AND (role = 'hod' OR office_id = ANY(office_ids))
  )
);
```
