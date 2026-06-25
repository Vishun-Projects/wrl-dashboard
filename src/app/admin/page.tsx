import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/auth/require-page-access';

export default async function AdminRedirect() {
  const userInfo = await requirePageAccess('/admin');
  redirect(userInfo.permissions.includes('manage_users') ? '/admin/users' : '/admin/roles');
}
