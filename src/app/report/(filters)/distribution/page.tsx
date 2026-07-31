import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/features/report/components/ReportLoadingFeedback';

const DistributionPageClient = dynamic(
  () => import('@/features/distribution/components/DistributionPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function DistributionPage() {
  await requirePageAccess('/report/distribution');
  return <DistributionPageClient />;
}
