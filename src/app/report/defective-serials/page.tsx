import dynamic from 'next/dynamic';
import { requirePageAccess } from '@/lib/auth/require-page-access';
import { ReportPageSkeleton } from '@/modules/mis/components/ReportLoadingFeedback';

const DefectiveSerialsPageClient = dynamic(
  () => import('@/modules/defective-serials/pages/DefectiveSerialsPageClient'),
  { loading: () => <ReportPageSkeleton /> }
);

export default async function DefectiveSerialsPage() {
  await requirePageAccess('/report/defective-serials');
  return <DefectiveSerialsPageClient />;
}
