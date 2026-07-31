import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/features/report/components/ReportLoadingFeedback';

const SerialAuditPageClient = dynamic(
  () => import('@/features/serial-audit/components/SerialAuditPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function SerialAuditPage() {
  await requirePageAccess('/report/serial-audit');
  return <SerialAuditPageClient />;
}
