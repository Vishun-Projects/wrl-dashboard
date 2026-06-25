import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/components/report/ReportLoadingFeedback';

const LocationAuditPageClient = dynamic(
  () => import('./location-audit-page-client'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function LocationAuditPage() {
  await requirePageAccess('/report/location-audit');
  return <LocationAuditPageClient />;
}
