'use client';

import React, { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { TruncatedText } from '@/components/ui/TruncatedText';
import type { CallRegisterRow } from '@/features/report/lib/call-register/types';

type GridSortKey =
  | 'client'
  | 'qty'
  | 'deployment'
  | 'installation'
  | 'balanceDeployment'
  | 'balanceInstallation';

type CallRegisterGridProps = {
  rows: CallRegisterRow[];
  onClientClick?: (client: string) => void;
};

function sortGridRows(
  rows: CallRegisterRow[],
  sortKey: GridSortKey,
  sortDir: 'asc' | 'desc'
): CallRegisterRow[] {
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === 'client') {
      return mul * a.client.localeCompare(b.client);
    }
    return mul * (a[sortKey] - b[sortKey]);
  });
}

function SortHint({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-0.5 text-slate-300">↕</span>;
  return dir === 'asc' ? (
    <ChevronUp className="inline ml-0.5" size={12} />
  ) : (
    <ChevronDown className="inline ml-0.5" size={12} />
  );
}

function SortTh({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  className?: string;
}) {
  return (
    <AdminTh className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-0.5 hover:text-slate-900"
      >
        {label}
        <SortHint active={active} dir={dir} />
      </button>
    </AdminTh>
  );
}

export const CallRegisterGrid = memo(function CallRegisterGrid({
  rows,
  onClientClick,
}: CallRegisterGridProps) {
  const [sortKey, setSortKey] = useState<GridSortKey>('client');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRows = useMemo(
    () => sortGridRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir]
  );

  const toggleSort = (key: GridSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-500">
        No records found for the selected date range.
      </div>
    );
  }

  return (
    <AdminTable className="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[20%]" />
        <col className="w-[12%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
        <col className="w-[12%]" />
        <col className="w-[14%]" />
        <col className="w-[14%]" />
      </colgroup>
      <AdminThead>
        <tr>
          <SortTh
            label="Client"
            active={sortKey === 'client'}
            dir={sortDir}
            onClick={() => toggleSort('client')}
          />
          <SortTh
            label="Billing Count"
            active={sortKey === 'qty'}
            dir={sortDir}
            onClick={() => toggleSort('qty')}
            className="text-right"
          />
          <SortTh
            label="Deployment"
            active={sortKey === 'deployment'}
            dir={sortDir}
            onClick={() => toggleSort('deployment')}
            className="text-right"
          />
          <SortTh
            label="Installation"
            active={sortKey === 'installation'}
            dir={sortDir}
            onClick={() => toggleSort('installation')}
            className="text-right"
          />
          <AdminTh className="text-center">Service Billing</AdminTh>
          <SortTh
            label="Balance Deploy"
            active={sortKey === 'balanceDeployment'}
            dir={sortDir}
            onClick={() => toggleSort('balanceDeployment')}
            className="text-right"
          />
          <SortTh
            label="Balance Install"
            active={sortKey === 'balanceInstallation'}
            dir={sortDir}
            onClick={() => toggleSort('balanceInstallation')}
            className="text-right"
          />
        </tr>
      </AdminThead>
      <tbody>
        {sortedRows.map((row) => (
          <AdminTr key={row.client} className="hover:bg-bg-soft/80">
            <AdminTd className="font-medium text-slate-800">
              {onClientClick ? (
                <button
                  type="button"
                  onClick={() => onClientClick(row.client)}
                  className="text-left text-blue-700 hover:text-blue-900 hover:underline underline-offset-2"
                >
                  <TruncatedText text={row.client} />
                </button>
              ) : (
                <TruncatedText text={row.client} />
              )}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.qty.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.deployment.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums text-slate-600">
              {row.installation.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-center text-slate-400">-</AdminTd>
            <AdminTd className="text-right tabular-nums font-semibold text-slate-900">
              {row.balanceDeployment.toLocaleString('en-IN')}
            </AdminTd>
            <AdminTd className="text-right tabular-nums font-semibold text-slate-900">
              {row.balanceInstallation.toLocaleString('en-IN')}
            </AdminTd>
          </AdminTr>
        ))}
      </tbody>
    </AdminTable>
  );
});
