import { ReportFiltersProvider } from '@/features/report/ui/ReportFiltersContext';

export default function ReportFiltersLayout({ children }: { children: React.ReactNode }) {
  return <ReportFiltersProvider>{children}</ReportFiltersProvider>;
}
