import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const WarrantyMasterPageClient = dynamic(
  () => import('@/modules/warranty-master/pages/WarrantyMasterPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function WarrantyMasterPage() {
  await requirePageAccess('/report/warranty-master');
  return <WarrantyMasterPageClient />;
}
