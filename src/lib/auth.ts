import { createClient } from './supabase/server';

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', user.id)
    .single();

  return { ...user, profile };
}

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: 'branch_manager' | 'hod' | 'super_admin';
  office_ids: string[];
  visible_statuses?: string[];
};
