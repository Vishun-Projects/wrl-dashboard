import { ReportFiltersProvider } from '@/contexts/ReportFiltersContext';

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <ReportFiltersProvider>{children}</ReportFiltersProvider>;
}
