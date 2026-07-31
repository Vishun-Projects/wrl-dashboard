import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const LocationAuditPageClient = dynamic(
  () => import('@/modules/location-audit/pages/LocationAuditPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function LocationAuditPage() {
  await requirePageAccess('/report/location-audit');
  return <LocationAuditPageClient />;
}
