import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const CancelledCallsPageClient = dynamic(
  () => import('@/modules/cancelled-calls/pages/CancelledCallsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function CancelledCallsPage() {
  await requirePageAccess('/report/cancelled-calls');
  return <CancelledCallsPageClient />;
}
