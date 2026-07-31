import dynamic from 'next/dynamic';
import { ReportPageSkeleton } from '@/features/report/components/ReportLoadingFeedback';
import { requirePageAccess } from '@/lib/auth/require-page-access';

const ReportPageClient = dynamic(() => import('@/features/report/components/ReportPageClient'), {
  loading: () => <ReportPageSkeleton />,
});

export default async function ReportPage() {
  await requirePageAccess('/report');
  return <ReportPageClient />;
}
