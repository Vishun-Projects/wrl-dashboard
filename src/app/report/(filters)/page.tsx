import dynamic from 'next/dynamic';
import { ReportPageSkeleton } from '@/components/report/ReportLoadingFeedback';
import { requirePageAccess } from '@/lib/auth/require-page-access';

const ReportPageClient = dynamic(() => import('@/components/report/ReportPageClient'), {
  loading: () => <ReportPageSkeleton />,
});

export default async function ReportPage() {
  await requirePageAccess('/report');
  return <ReportPageClient />;
}
