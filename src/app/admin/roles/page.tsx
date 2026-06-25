import { requirePageAccess } from '@/lib/auth/require-page-access';
import RolesPageClient from './roles-page-client';

export default async function RolesPage() {
  await requirePageAccess('/admin/roles');
  return <RolesPageClient />;
}
