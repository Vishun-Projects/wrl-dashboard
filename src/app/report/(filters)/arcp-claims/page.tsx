import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/components/report/ReportLoadingFeedback';

const ArcpClaimsPageClient = dynamic(
  () => import('./arcp-claims-page-client'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function ArcpClaimsPage() {
  await requirePageAccess('/report/arcp-claims');
  return <ArcpClaimsPageClient />;
}
