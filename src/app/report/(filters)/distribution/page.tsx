import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const DistributionPageClient = dynamic(
  () => import('@/modules/distribution/pages/DistributionPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function DistributionPage() {
  await requirePageAccess('/report/distribution');
  return <DistributionPageClient />;
}
