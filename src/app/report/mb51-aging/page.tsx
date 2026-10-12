import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const Mb51AgingPageClient = dynamic(
  () => import('@/modules/mb51-aging/pages/Mb51AgingPageClient'),
  {
    loading: () => <ReportPageSkeleton />,
  }
);

export default async function Mb51AgingPage() {
  await requirePageAccess('/report/mb51-aging');
  return <Mb51AgingPageClient />;
}
