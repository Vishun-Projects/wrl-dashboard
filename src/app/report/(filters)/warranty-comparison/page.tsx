import dynamic from 'next/dynamic';
import { Metadata } from 'next';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

export const metadata: Metadata = {
  title: 'Warranty Comparison | Reports',
  description: 'Compare service call WCO against Warranty Master machine expiration dates',
};

const WarrantyComparisonPageClient = dynamic(
  () => import('@/modules/warranty-comparison/pages/WarrantyComparisonPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function WarrantyComparisonPage() {
  await requirePageAccess('/report/warranty-comparison');
  return <WarrantyComparisonPageClient />;
}
