import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const CallVisitsPageClient = dynamic(
  () => import('@/modules/call-visits/pages/CallVisitsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function CallVisitsPage() {
  await requirePageAccess('/report/call-visits');
  return <CallVisitsPageClient />;
}
