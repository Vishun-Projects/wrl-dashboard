import { createClient } from './supabase/server';
import { prisma } from './prisma';

export async function getUserInfo() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, permissions] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT * FROM public.app_users WHERE id = $1', user.id),
    (prisma as any).getUserPermissions(user.id)
  ]);

  const profile = (profileResult as any[])[0];
  return profile ? { ...profile, permissions } : null;
}

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: 'branch_manager' | 'hod' | 'super_admin';
  office_ids: string[];
  visible_statuses?: string[];
  permissions: string[];
};
