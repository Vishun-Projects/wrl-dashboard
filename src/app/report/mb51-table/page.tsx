import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const Mb51TablePageClient = dynamic(
  () => import('@/modules/mb51-aging/pages/Mb51TablePageClient'),
  {
    loading: () => <ReportPageSkeleton />,
  }
);

export default async function Mb51TablePage() {
  await requirePageAccess('/report/mb51-table');
  return <Mb51TablePageClient />;
}
