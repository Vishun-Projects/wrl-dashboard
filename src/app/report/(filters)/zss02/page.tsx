import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const Zss02PageClient = dynamic(() => import('@/modules/zss02/pages/Zss02PageClient'), {
  loading: () => <ReportPageSkeleton />,
});

export default async function Zss02Page() {
  await requirePageAccess('/report/zss02');
  return <Zss02PageClient />;
}
