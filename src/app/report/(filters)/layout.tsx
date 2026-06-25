import { ReportFiltersProvider } from '@/contexts/ReportFiltersContext';

export default function ReportFiltersLayout({ children }: { children: React.ReactNode }) {
  return <ReportFiltersProvider>{children}</ReportFiltersProvider>;
}
