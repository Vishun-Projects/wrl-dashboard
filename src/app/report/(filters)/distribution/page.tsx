import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/components/report/ReportLoadingFeedback';

const DistributionPageClient = dynamic(
  () => import('./distribution-page-client'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function DistributionPage() {
  await requirePageAccess('/report/distribution');
  return <DistributionPageClient />;
}
