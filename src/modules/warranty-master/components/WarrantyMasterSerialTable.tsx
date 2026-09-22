'use client';

import React, { memo, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';
import type { WarrantyMasterSerialRow } from '@/modules/warranty-master/services';
import { feedback } from '@/lib/ui/feedback';

type SerialSortKey =
  | 'serialNo'
  | 'customerSubgroup'
  | 'groupName'
  | 'fgModel'
  | 'warrantyMonths'
  | 'warrStartDt'
  | 'warrEndDt'
  | 'isActive';

function serialSortValue(row: WarrantyMasterSerialRow, key: SerialSortKey): unknown {
  switch (key) {
    case 'serialNo':
      return row.serialNo;
    case 'customerSubgroup':
      return row.customerSubgroup ?? '(Unknown)';
    case 'groupName':
      return row.groupName;
    case 'fgModel':
      return row.fgModel;
    case 'warrantyMonths':
      return row.warrantyMonths;
    case 'warrStartDt':
      return row.warrStartDt ?? '';
    case 'warrEndDt':
      return row.warrEndDt ?? '';
    case 'isActive':
      return row.isActive ? 1 : 0;
    default:
      return '';
  }
}

type WarrantyMasterSerialTableProps = {
  rows: WarrantyMasterSerialRow[];
  loading?: boolean;
};

export const WarrantyMasterSerialTable = memo(function WarrantyMasterSerialTable({
  rows,
  loading: _loading = false,
}: WarrantyMasterSerialTableProps) {
  const [sort, setSort] = useState<TableSortState<SerialSortKey> | null>({
    key: 'serialNo',
    dir: 'asc',
  });
  const [copiedSerial, setCopiedSerial] = useState<string | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return sortRows(rows, (row) => serialSortValue(row, sort.key), sort.dir);
  }, [rows, sort]);

  const handleSort = (key: SerialSortKey) => {
    setSort((p) => toggleSort(p, key, key === 'serialNo' || key === 'customerSubgroup' ? 'asc' : 'desc'));
  };

  const handleCopySerial = async (serial: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(serial);
      setCopiedSerial(serial);
      feedback.actionSuccess(`Copied ${serial}`);
      setTimeout(() => setCopiedSerial((prev) => (prev === serial ? null : prev)), 2000);
    } catch {
      feedback.actionFailed('Failed to copy');
    }
  };

  return (
    <AdminTable className="warranty-master-serials-table w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-[18%]" />
        <col className="w-[22%]" />
        <col className="w-[14%]" />
        <col className="w-[18%]" />
        <col className="w-[8%]" />
        <col className="w-[9%]" />
        <col className="w-[9%]" />
        <col className="w-[8%]" />
      </colgroup>
      <AdminThead>
        <tr>
          <AdminTh
            sortable
            sortKey="serialNo"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Serial No
          </AdminTh>
          <AdminTh
            sortable
            sortKey="customerSubgroup"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Customer subgroup
          </AdminTh>
          <AdminTh
            sortable
            sortKey="groupName"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Group
          </AdminTh>
          <AdminTh
            sortable
            sortKey="fgModel"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            FG Model
          </AdminTh>
          <AdminTh
            sortable
            sortKey="warrantyMonths"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Warranty
          </AdminTh>
          <AdminTh
            sortable
            sortKey="warrStartDt"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Start Date
          </AdminTh>
          <AdminTh
            sortable
            sortKey="warrEndDt"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            End Date
          </AdminTh>
          <AdminTh
            sortable
            sortKey="isActive"
            sort={sort}
            onSort={(k) => handleSort(k as SerialSortKey)}
          >
            Status
          </AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {sortedRows.map((row, idx) => {
          const isCopied = copiedSerial === row.serialNo;
          return (
            <AdminTr key={`${row.serialNo}-${idx}`} className="hover:bg-bg-soft/70">
              <AdminTd className="font-mono text-[12px] font-semibold text-slate-900">
                <div className="flex items-center gap-1.5">
                  <span className="truncate" title={row.serialNo}>
                    {row.serialNo}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => void handleCopySerial(row.serialNo, e)}
                    className="shrink-0 p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                    title="Copy serial number"
                  >
                    {isCopied ? (
                      <Check className="h-3 w-3 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </AdminTd>
              <AdminTd className="font-medium text-slate-800">
                <TruncatedText text={row.customerSubgroup ?? '(Unknown)'} />
              </AdminTd>
              <AdminTd className="text-slate-600">
                <TruncatedText text={row.groupName} />
              </AdminTd>
              <AdminTd className="text-slate-700 font-medium">
                <TruncatedText text={row.fgModel} />
              </AdminTd>
              <AdminTd className="tabular-nums text-slate-600">
                {row.warrantyMonths} mo
              </AdminTd>
              <AdminTd className="tabular-nums text-slate-600 text-[11px]">
                {row.warrStartDt ?? '—'}
              </AdminTd>
              <AdminTd className="tabular-nums text-slate-600 text-[11px]">
                {row.warrEndDt ?? '—'}
              </AdminTd>
              <AdminTd>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    row.isActive
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  {row.isActive ? 'Active' : 'Expired'}
                </span>
              </AdminTd>
            </AdminTr>
          );
        })}
      </tbody>
    </AdminTable>
  );
});
