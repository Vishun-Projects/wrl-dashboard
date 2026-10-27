import { requirePageAccess } from '@/lib/auth/require-page-access';
import { DashboardHomeClient } from './DashboardHomeClient';

export default async function DashboardPage() {
  await requirePageAccess('/dashboard');
  return <DashboardHomeClient />;
}
