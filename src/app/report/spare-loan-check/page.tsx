import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const SpareLoanCheckPageClient = dynamic(
  () => import('@/modules/spare-loan-check/pages/SpareLoanCheckPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function SpareLoanCheckPage() {
  await requirePageAccess('/report/spare-loan-check');
  return <SpareLoanCheckPageClient />;
}
