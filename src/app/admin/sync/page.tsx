import { requirePageAccess } from '@/lib/auth/require-page-access';
import ReadModelSyncPageClient from './sync-page-client';

export default async function ReadModelSyncPage() {
  await requirePageAccess('/admin/sync');
  return <ReadModelSyncPageClient />;
}
