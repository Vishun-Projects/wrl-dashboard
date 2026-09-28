import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const RejectedCallsPageClient = dynamic(
  () => import('@/modules/rejected-calls/pages/RejectedCallsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function RejectedCallsPage() {
  await requirePageAccess('/report/rejected-calls');
  return <RejectedCallsPageClient />;
}
