import { requirePageAccess } from '@/lib/auth/require-page-access';
import ReadModelSyncPageClient from '@/modules/sync/pages/SyncPageClient';

export default async function ReadModelSyncPage() {
  await requirePageAccess('/admin/sync');
  return <ReadModelSyncPageClient />;
}
