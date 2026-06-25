import { requirePageAccess } from '@/lib/auth/require-page-access';
import AdminUsersPageClient from './users-page-client';

export default async function AdminUsersPage() {
  await requirePageAccess('/admin/users');
  return <AdminUsersPageClient />;
}
