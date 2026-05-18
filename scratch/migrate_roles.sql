-- Roles table
CREATE TABLE IF NOT EXISTS public.app_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions table
CREATE TABLE IF NOT EXISTS public.app_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Role-Permissions link
CREATE TABLE IF NOT EXISTS public.app_role_permissions (
    role_id UUID REFERENCES public.app_roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES public.app_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Add role_id to app_users
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='app_users' AND column_name='role_id') THEN
        ALTER TABLE public.app_users ADD COLUMN role_id UUID REFERENCES public.app_roles(id);
    END IF;
END $$;

-- Initial Permissions
INSERT INTO public.app_permissions (name, description) VALUES
('view_calls', 'Access to the calls dashboard'),
('manage_users', 'Create, edit, and delete users'),
('view_reports', 'Access to MIS reports'),
('manage_roles', 'Manage roles and permissions'),
('delete_calls', 'Ability to delete call records')
ON CONFLICT (name) DO NOTHING;

-- Initial Roles
INSERT INTO public.app_roles (name, description) VALUES
('HOD', 'Head of Department with full system access'),
('Branch Manager', 'Manager with access to specific branch data')
ON CONFLICT (name) DO NOTHING;

-- Map HOD permissions (Full access)
INSERT INTO public.app_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.app_roles r, public.app_permissions p
WHERE r.name = 'HOD'
ON CONFLICT DO NOTHING;

-- Map Branch Manager permissions (Restricted)
INSERT INTO public.app_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.app_roles r, public.app_permissions p
WHERE r.name = 'Branch Manager' AND p.name IN ('view_calls')
ON CONFLICT DO NOTHING;

-- Migrate existing users based on current 'role' string
UPDATE public.app_users SET role_id = (SELECT id FROM public.app_roles WHERE name = 'HOD') WHERE role = 'hod' AND role_id IS NULL;
UPDATE public.app_users SET role_id = (SELECT id FROM public.app_roles WHERE name = 'Branch Manager') WHERE role = 'branch_manager' AND role_id IS NULL;
