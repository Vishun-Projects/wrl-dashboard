'use client';

import type { BdMisGrandRow, BdMisRegionalRow } from '@/features/report/services/bd-mis-summary';
import { useMemo, useState } from 'react';
import { SortableTh } from '@/components/ui/SortableTh';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

function regionPerfRowClass(region: string): string {
  const key = region.toUpperCase();
  if (key.includes('NORTH')) return 'bg-sky-50/80';
  if (key.includes('EAST')) return 'bg-emerald-50/80';
  if (key.includes('WEST')) return 'bg-amber-50/80';
  if (key.includes('SOUTH')) return 'bg-violet-50/80';
  return 'bg-slate-50/80';
}

function formatRegionLabel(region: string): string {
  if (region === 'ALL') return 'All';
  return region.replace(/\s+ZONE$/i, '');
}

type BdMisSortKey = keyof BdMisRegionalRow;

type Props = {
  rows: BdMisRegionalRow[];
  grand: BdMisGrandRow;
  loading?: boolean;
};

const TH =
  'p-2 border border-slate-300 text-center';
const TH_FIRST = 'p-2 border-r border-slate-300/30';

export function BdMisSummaryPanel({ rows, grand, loading }: Props) {
  const [sort, setSort] = useState<TableSortState<BdMisSortKey> | null>(null);
  const sortedRows = useMemo(
    () => (sort ? sortRows(rows, (r) => r[sort.key], sort.dir) : rows),
    [rows, sort]
  );

  const th = (key: BdMisSortKey, label: string, first = false) => (
    <SortableTh
      className={first ? TH_FIRST : TH}
      align={first ? 'left' : 'center'}
      active={sort?.key === key}
      dir={sort?.dir}
      onClick={() => setSort((p) => toggleSort(p, key, key === 'region' ? 'asc' : 'desc'))}
    >
      {label}
    </SortableTh>
  );

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-2">
        <h2 className="text-[11px] text-slate-500 ui-label">
          Regional Performance (CRM + Cadbury + Coke)
        </h2>
        <p className="text-[10px] text-slate-400">
          BD MIS Excel union — CRM + Mondelez + HCCB; total calls exclude cancelled, cancelled column shown separately
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-bg-canvas shadow-sm">
        <table className="perf-dashboard-table w-full text-left border-collapse text-[11px]">
          <thead className="perf-table-header">
            <tr className="text-white text-[10px] ui-label border-b border-blue-800">
              {th('region', 'Region', true)}
              {th('total_calls', 'Total calls')}
              {th('total_solved', 'Total solved')}
              {th('open_calls', '# open calls')}
              {th('age_2', '≤2 days')}
              {th('age_3', '3-7 days')}
              {th('age_7', '8-15 days')}
              {th('age_15', '>15 days')}
              {th('active_eng', '# of active Eng.')}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.region}
                className={`${regionPerfRowClass(row.region)} text-slate-900 ui-strong`}
              >
                <td className="p-2 border border-slate-300">{formatRegionLabel(row.region)}</td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.total_calls.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums text-emerald-600">
                  {loading ? '…' : row.total_solved.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums perf-metric-open ui-strong">
                  {loading ? '…' : row.open_calls.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.age_2.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.age_3.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.age_7.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.age_15.toLocaleString()}
                </td>
                <td className="p-2 border border-slate-300 text-center tabular-nums">
                  {loading ? '…' : row.active_eng.toLocaleString()}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-100 text-slate-900 ui-strong border-t-2 border-slate-400">
              <td className="p-2 border border-slate-300">All</td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.total_calls.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums text-emerald-600">
                {loading ? '…' : grand.total_solved.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums perf-metric-open ui-strong">
                {loading ? '…' : grand.open_calls.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.age_2.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.age_3.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.age_7.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.age_15.toLocaleString()}
              </td>
              <td className="p-2 border border-slate-300 text-center tabular-nums">
                {loading ? '…' : grand.active_eng.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
