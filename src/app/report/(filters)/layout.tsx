import { ReportFiltersProvider } from '@/features/report/components/ReportFiltersContext';

export default function ReportFiltersLayout({ children }: { children: React.ReactNode }) {
  return <ReportFiltersProvider>{children}</ReportFiltersProvider>;
}
