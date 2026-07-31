import { ReportFiltersProvider } from '@/modules/mis/components/ReportFiltersContext';

export default function ReportFiltersLayout({ children }: { children: React.ReactNode }) {
  return <ReportFiltersProvider>{children}</ReportFiltersProvider>;
}
