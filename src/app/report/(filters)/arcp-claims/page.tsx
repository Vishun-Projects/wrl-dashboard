import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const ArcpClaimsPageClient = dynamic(
  () => import('@/modules/arcp/pages/ArcpClaimsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function ArcpClaimsPage() {
  await requirePageAccess('/report/arcp-claims');
  return <ArcpClaimsPageClient />;
}
