import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const WarrantyProvisionPageClient = dynamic(
  () => import('@/modules/warranty-provision/pages/WarrantyProvisionPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function WarrantyProvisionPage() {
  await requirePageAccess('/report/warranty-provision');
  return <WarrantyProvisionPageClient />;
}
