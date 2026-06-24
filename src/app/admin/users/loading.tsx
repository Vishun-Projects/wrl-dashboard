import { TableSkeleton } from '@/components/ui/DataTableLoading';

export default function AdminUsersLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <TableSkeleton columns={5} rows={8} />
    </div>
  );
}
