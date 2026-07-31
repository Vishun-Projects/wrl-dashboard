import { requirePageAccess } from '@/lib/auth/require-page-access';
import AdminUsersPageClient from '@/modules/users/pages/UsersPageClient';

export default async function AdminUsersPage() {
  await requirePageAccess('/admin/users');
  return <AdminUsersPageClient />;
}
