import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const ArcpProvisionPageClient = dynamic(
  () => import('@/modules/arcp-provision/pages/ArcpProvisionPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function ArcpProvisionPage() {
  await requirePageAccess('/report/arcp-provision');
  return <ArcpProvisionPageClient />;
}
