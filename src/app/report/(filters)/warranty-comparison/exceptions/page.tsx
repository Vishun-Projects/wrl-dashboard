import dynamic from 'next/dynamic';
import { Metadata } from 'next';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

export const metadata: Metadata = {
  title: 'Warranty Exception Accounts | Reports',
  description: 'Configure AMC and compressor exception accounts for Warranty Comparison',
};

const WarrantyExceptionAccountsPageClient = dynamic(
  () => import('@/modules/warranty-comparison/pages/WarrantyExceptionAccountsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function WarrantyExceptionAccountsPage() {
  await requirePageAccess('/report/warranty-comparison');
  return <WarrantyExceptionAccountsPageClient />;
}
