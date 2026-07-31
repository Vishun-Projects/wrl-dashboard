'use client';

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import {
  AdminTable,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { Collapse } from '@/components/motion';
import { WarrantyMasterFgDetailTable } from '@/modules/warranty/components/WarrantyMasterFgDetailTable';
import { TruncatedText } from '@/components/ui/TruncatedText';
import { instantTransition, layoutSpring, usePrefersReducedMotion } from '@/lib/motion/presets';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';
import {
  aggregateRowKey,
  fgDetailRowsForAggregateFromIndex,
  type WarrantyMasterAggregateRow,
  type WarrantyMasterClientFilters,
  type WarrantyMasterFgDetailIndex,
  type WarrantyMasterFgDetailRow,
} from '@/modules/warranty/services';

type WarrantySortKey = 'customer' | 'group' | 'warrantyMonths' | 'machines';

function warrantySortValue(row: WarrantyMasterAggregateRow, key: WarrantySortKey): unknown {
  switch (key) {
    case 'customer':
      return row.customerName;
    case 'group':
      return row.groupName;
    case 'warrantyMonths':
      return row.warrantyMonths;
    case 'machines':
      return row.machineCount;
    default:
      return '';
  }
}

type WarrantyMasterTableProps = {
  rows: WarrantyMasterAggregateRow[];
  filters: WarrantyMasterClientFilters;
  fgDetailIndex: WarrantyMasterFgDetailIndex;
  expandedKey: string | null;
  onToggleExpand: (row: WarrantyMasterAggregateRow) => void;
};

type DataRowProps = {
  row: WarrantyMasterAggregateRow;
  isExpanded: boolean;
  detailRows: WarrantyMasterFgDetailRow[] | null;
  onToggle: () => void;
};

const WarrantyMasterDataRow = memo(function WarrantyMasterDataRow({
  row,
  isExpanded,
  detailRows,
  onToggle,
}: DataRowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [cachedDetail, setCachedDetail] = useState<WarrantyMasterFgDetailRow[] | null>(null);
  const isExpandedRef = useRef(isExpanded);

  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  useEffect(() => {
    if (detailRows) setCachedDetail(detailRows);
  }, [detailRows]);

  const showDetailRow = cachedDetail !== null;

  return (
    <>
      <AdminTr
        className={`warranty-master-row cursor-pointer ${isExpanded ? 'bg-bg-soft' : 'hover:bg-bg-soft/80'}`}
        onClick={onToggle}
      >
        <AdminTd className="w-8 text-slate-400">
          <motion.span
            className="inline-flex"
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={reducedMotion ? instantTransition() : layoutSpring}
          >
            <ChevronRight size={14} />
          </motion.span>
        </AdminTd>
        <AdminTd className="max-w-[14rem] font-medium text-slate-800">
          <TruncatedText text={row.customerName} />
        </AdminTd>
        <AdminTd className="text-slate-600">{row.groupName}</AdminTd>
        <AdminTd className="tabular-nums text-slate-600">{row.warrantyMonths}</AdminTd>
        <AdminTd className="text-right tabular-nums font-semibold text-slate-900">
          {row.machineCount.toLocaleString('en-IN')}
        </AdminTd>
      </AdminTr>
      {showDetailRow ? (
        <AdminTr className="warranty-master-row-expanded border-b border-slate-100 bg-bg-soft/60">
          <td colSpan={5} className="warranty-master-expanded-cell p-0">
            <Collapse
              open={isExpanded && !!detailRows}
              onExitComplete={() => {
                if (!isExpandedRef.current) setCachedDetail(null);
              }}
            >
              <WarrantyMasterFgDetailTable
                rows={cachedDetail ?? []}
                parentMachineCount={row.machineCount}
                customerName={row.customerName}
                groupName={row.groupName}
                warrantyMonths={row.warrantyMonths}
              />
            </Collapse>
          </td>
        </AdminTr>
      ) : null}
    </>
  );
});

export const WarrantyMasterTable = memo(function WarrantyMasterTable({
  rows,
  filters,
  fgDetailIndex,
  expandedKey,
  onToggleExpand,
}: WarrantyMasterTableProps) {
  const [sort, setSort] = useState<TableSortState<WarrantySortKey> | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return sortRows(rows, (row) => warrantySortValue(row, sort.key), sort.dir);
  }, [rows, sort]);

  const handleSort = (key: WarrantySortKey) => {
    setSort((p) =>
      toggleSort(p, key, key === 'customer' || key === 'group' ? 'asc' : 'desc')
    );
  };

  const expandedDetail = useMemo(() => {
    if (!expandedKey) return null;
    const row = rows.find((r) => aggregateRowKey(r) === expandedKey);
    if (!row) return null;
    return fgDetailRowsForAggregateFromIndex(fgDetailIndex, row, filters);
  }, [expandedKey, rows, fgDetailIndex, filters]);

  return (
    <AdminTable className="warranty-master-table w-full table-fixed border-collapse text-left">
      <colgroup>
        <col className="w-8" />
        <col className="w-[34%]" />
        <col className="w-[26%]" />
        <col className="w-[22%]" />
        <col className="w-[18%]" />
      </colgroup>
      <AdminThead>
        <tr>
          <AdminTh className="w-8">
            <span className="sr-only">Expand</span>
          </AdminTh>
          <AdminTh
            sortable
            sortKey="customer"
            sort={sort}
            onSort={(k) => handleSort(k as WarrantySortKey)}
          >
            Customer
          </AdminTh>
          <AdminTh
            sortable
            sortKey="group"
            sort={sort}
            onSort={(k) => handleSort(k as WarrantySortKey)}
          >
            Group
          </AdminTh>
          <AdminTh
            sortable
            sortKey="warrantyMonths"
            sort={sort}
            onSort={(k) => handleSort(k as WarrantySortKey)}
          >
            Warranty (months)
          </AdminTh>
          <AdminTh
            className="text-right"
            sortable
            sortKey="machines"
            sort={sort}
            onSort={(k) => handleSort(k as WarrantySortKey)}
            align="right"
          >
            Machines
          </AdminTh>
        </tr>
      </AdminThead>
      <tbody>
        {sortedRows.map((row) => {
          const key = aggregateRowKey(row);
          const isExpanded = expandedKey === key;
          return (
            <WarrantyMasterDataRow
              key={key}
              row={row}
              isExpanded={isExpanded}
              detailRows={isExpanded ? expandedDetail : null}
              onToggle={() => onToggleExpand(row)}
            />
          );
        })}
      </tbody>
    </AdminTable>
  );
});
