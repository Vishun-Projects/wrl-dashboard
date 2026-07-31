import { requirePageAccess } from '@/lib/auth/require-page-access';
import RolesPageClient from '@/modules/roles/pages/RolesPageClient';

export default async function RolesPage() {
  await requirePageAccess('/admin/roles');
  return <RolesPageClient />;
}
