import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/features/report/ui/ReportLoadingFeedback';

const WarrantyMasterPageClient = dynamic(
  () => import('./warranty-master-page-client'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function WarrantyMasterPage() {
  await requirePageAccess('/report/warranty-master');
  return <WarrantyMasterPageClient />;
}
