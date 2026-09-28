import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const SpareStockAnalysisPageClient = dynamic(
  () => import('@/modules/spare-stock-analysis/pages/SpareStockAnalysisPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function SpareStockAnalysisPage() {
  await requirePageAccess('/report/spare-stock-analysis');
  return <SpareStockAnalysisPageClient />;
}
