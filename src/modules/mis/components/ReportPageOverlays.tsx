'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { SortableTh } from '@/components/ui/SortableTh';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

const CallDetail = dynamic(
  () => import('@/components/calls/CallDetail').then((m) => ({ default: m.CallDetail })),
  { ssr: false }
);
import type { CallDetailData } from '@/components/calls/CallDetail';

export type ReportDrillDownState = {
  isOpen: boolean;
  loading: boolean;
  data: Array<Record<string, unknown>>;
  type: string;
  title: string;
  params: Record<string, unknown> | null;
};

type Props = {
  isDrawerOpen: boolean;
  selectedCall: Record<string, unknown> | null;
  onCloseDrawer: () => void;
  onFlagUpdate: (id: string, flag: string) => void | Promise<void>;
  onPostComment: (id: string, text: string) => void | Promise<void>;
  drillDown: ReportDrillDownState;
  setDrillDown: Dispatch<SetStateAction<ReportDrillDownState>>;
  handleSelectCall: (callId: string, row?: Record<string, unknown>) => void | Promise<void>;
};

export function ReportPageOverlays({
  isDrawerOpen,
  selectedCall,
  onCloseDrawer,
  onFlagUpdate,
  onPostComment,
  drillDown,
  setDrillDown,
  handleSelectCall,
}: Props) {
  const [drillSort, setDrillSort] = useState<TableSortState | null>(null);
  const drillKeys =
    drillDown.data.length > 0 ? Object.keys(drillDown.data[0] as Record<string, unknown>) : [];
  const sortedDrillData = useMemo(() => {
    if (!drillSort) return drillDown.data;
    return sortRows(drillDown.data, (row) => row[drillSort.key], drillSort.dir);
  }, [drillDown.data, drillSort]);

  return (
    <>
      {/* Engineer Popup */}
      {isDrawerOpen && selectedCall && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
          <div className="modal-backdrop fixed inset-0 animate-in fade-in duration-200" onClick={() => onCloseDrawer()} />
          <div className="relative bg-bg-canvas shadow rounded-lg w-full max-w-[900px] h-[min(760px,92vh)] flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200">
            <CallDetail
              call={selectedCall as CallDetailData}
              onClose={() => onCloseDrawer()}
              onFlagUpdate={onFlagUpdate}
              onPostComment={onPostComment}
            />
          </div>
        </div>
      )}

      {/* Drill Down Side Panel */}
      {drillDown.isOpen && (
        <div className="fixed inset-0 z-[200] flex justify-end">
          <div className="modal-backdrop absolute inset-0 backdrop-blur-sm" onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} />
          <div className="relative w-full max-w-5xl bg-bg-canvas h-full shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-bg-soft">
              <div>
                <h3 className="text-sm text-slate-900 ui-label">{drillDown.title}</h3>
                <p className="text-[10px] text-slate-500 font-medium">Detailed breakdown of selected metric</p>
              </div>
              <button onClick={() => setDrillDown(prev => ({ ...prev, isOpen: false }))} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] text-slate-700 flex items-center gap-2 ui-label">
                    Detail Records
                    <span className="ui-chip px-2 py-0.5 bg-slate-100 rounded-full ui-strong">{drillDown.data.length} Results</span>
                  </h4>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="sticky top-0 bg-bg-soft border-b border-slate-200 z-10">
                        <tr>
                          {drillKeys.map((key) => (
                            <SortableTh
                              key={key}
                              className="p-3 border-r border-slate-100 whitespace-nowrap"
                              active={drillSort?.key === key}
                              dir={drillSort?.dir}
                              onClick={() => setDrillSort((p) => toggleSort(p, key, 'asc'))}
                            >
                              {key}
                            </SortableTh>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drillDown.loading ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <div className="flex flex-col items-center gap-3">
                                <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                                <p className="text-[10px] font-medium text-slate-400">Executing Query...</p>
                              </div>
                            </td>
                          </tr>
                        ) : sortedDrillData.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-20 text-center">
                              <p className="text-xs font-medium text-slate-400">No data available for this metric</p>
                            </td>
                          </tr>
                        ) : (
                          sortedDrillData.map((row, i) => {
                            const callIdRaw = row['Ref No'] ?? row['vtrnno'] ?? row['Ref. No'];
                            const callId =
                              callIdRaw != null && String(callIdRaw).trim() !== '' && String(callIdRaw) !== '—'
                                ? String(callIdRaw)
                                : null;
                            return (
                              <tr 
                                key={i} 
                                className={`transition-colors group ${callId ? 'cursor-pointer hover:bg-blue-50' : 'hover:bg-bg-soft'}`}
                                onClick={() => {
                                  if (callId) {
                                    void handleSelectCall(callId);
                                  }
                                }}
                              >
                                {drillKeys.map((key) => (
                                  <td key={key} className="p-3 border-r border-slate-50 whitespace-nowrap text-slate-600 group-hover:text-slate-900 font-medium truncate max-w-[200px]">
                                    {String(row[key] ?? '—')}
                                  </td>
                                ))}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
