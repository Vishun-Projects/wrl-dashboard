import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/features/report/components/ReportLoadingFeedback';

const ArcpClaimsPageClient = dynamic(
  () => import('@/features/arcp/components/ArcpClaimsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function ArcpClaimsPage() {
  await requirePageAccess('/report/arcp-claims');
  return <ArcpClaimsPageClient />;
}
