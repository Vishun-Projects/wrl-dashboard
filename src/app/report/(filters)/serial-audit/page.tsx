import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/components/report/ReportLoadingFeedback';

const SerialAuditPageClient = dynamic(
  () => import('./serial-audit-page-client'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function SerialAuditPage() {
  await requirePageAccess('/report/serial-audit');
  return <SerialAuditPageClient />;
}
