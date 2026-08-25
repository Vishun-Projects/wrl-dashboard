import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const AthenaReconciliationPageClient = dynamic(
  () => import('@/modules/athena-reconciliation/pages/AthenaReconciliationPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function AthenaReconciliationPage() {
  await requirePageAccess('/report/athena-reconciliation');
  return <AthenaReconciliationPageClient />;
}
