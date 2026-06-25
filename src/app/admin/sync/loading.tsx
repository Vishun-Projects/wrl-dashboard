import { TableSkeleton } from '@/components/ui/DataTableLoading';

export default function AdminSyncLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <TableSkeleton columns={4} rows={6} />
    </div>
  );
}
