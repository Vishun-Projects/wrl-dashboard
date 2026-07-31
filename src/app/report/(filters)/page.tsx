import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const ReportPageClient = dynamic(
  () => import('@/modules/mis/pages/ReportPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function ReportPage() {
  await requirePageAccess('/report');
  return <ReportPageClient />;
}
