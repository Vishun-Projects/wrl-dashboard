import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const SerialAuditPageClient = dynamic(
  () => import('@/modules/serial-history/pages/SerialAuditPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function SerialAuditPage() {
  await requirePageAccess('/report/serial-audit');
  return <SerialAuditPageClient />;
}
