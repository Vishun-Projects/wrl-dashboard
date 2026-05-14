'use client';

import React from 'react';
import { Tooltip } from './Tooltip';
import { CheckCircle2, AlertCircle, XCircle, Copy, Package, MessageSquare, StickyNote, Wrench } from 'lucide-react';

interface CallTableProps {
  calls: any[];
  onFlagUpdate: (id: string, flag: string) => void;
  onSelectCall: (id: string) => void;
  onCopy?: (text: string) => void;
  selectedId?: string | null;
  activeTab?: string;
}

export const CallTable = React.memo(function CallTable({ calls, onFlagUpdate, onSelectCall, onCopy, selectedId, activeTab }: CallTableProps) {
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleCopy = (e: React.MouseEvent, text: string, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="w-full bg-white border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-left border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '10%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Reference</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Logged Date</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Customer</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Complaint</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Status</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider">Technician</th>
            <th className="px-5 py-3 text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider text-center">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f1f5f9]">
          {calls.map((call, index) => {
            const callId = call.id || call.ncode;
            const flag = call.audit_flag || call.flag;

            const auditColors = {
              noted: { bg: "#f0fdf4", text: "#16a34a" },
              query: { bg: "#fffbeb", text: "#d97706" },
              escalate: { bg: "#fff1f2", text: "#e11d48" },
              unseen: { bg: "#f1f5f9", text: "#94a3b8" }
            };

            const currentAudit = flag || 'unseen';
            const colors = auditColors[currentAudit as keyof typeof auditColors];

            return (
              <tr
                key={`${callId}-${index}`}
                onClick={() => onSelectCall(callId)}
                className={`group cursor-pointer transition-all ${selectedId === callId ? 'bg-[#f8fafc]' : index % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'} hover:bg-[#f1f5f9]/40`}
              >
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Tooltip content={copiedId === call.id ? "Copied to clipboard!" : "Click to Copy"}>
                      <span
                        className="text-[12px] text-[#64748b] font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-100 group-hover:border-slate-300 transition-colors cursor-pointer active:scale-95"
                        onClick={(e) => handleCopy(e, call.vtrnno || call.vtransfercallno, call.id)}
                      >
                        {call.vtrnno || call.vtransfercallno || 'N/A'}
                      </span>
                    </Tooltip>
                    {(!call.vtrnno || call.vtrnno.trim() === '') && call.vtransfercallno && (
                      <span className="text-[9px] text-[#3b82f6] bg-[#eff6ff] px-1 py-0.5 rounded font-medium border border-[#bfdbfe]" title="Transferred Call">
                        Trf
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="text-[12px] text-[#0f172a] font-medium">
                    {call.logged_at ? new Date(call.logged_at).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </div>
                  <div className="text-[10px] text-[#94a3b8] font-normal">
                    {call.logged_at ? new Date(call.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="text-[13px] text-[#0f172a] font-medium leading-tight truncate">{call.customer_name}</div>
                    {activeTab === 'all' && call.is_major_repair === 'True' && (
                      <span className="text-[9px] font-black bg-rose-500 text-white px-1.5 py-0.5 rounded-sm tracking-tighter shadow-sm flex-shrink-0">
                        MAJOR
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5 font-normal truncate">
                    {call.branch_name}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="text-[12px] text-[#64748b] font-normal italic truncate" title={call.vcomplaint}>
                    "{call.vcomplaint || '—'}"
                  </div>
                </td>
                <td className="px-5 py-4">
                  {(() => {
                    const getStatusStyle = (label: string) => {
                      if (label === 'Tech. Solve Call') return { label: 'Tech. Solve', color: 'text-indigo-600', bg: 'bg-indigo-50', dot: 'bg-indigo-500' };
                      if (label.includes('Assigned') || label.includes('Allocated')) return { label: 'Assigned', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' };
                      if (label === 'Closed') return { label: 'Closed', color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500' };
                      if (label === 'Rejected') return { label: 'Rejected', color: 'text-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-500' };
                      if (label === 'Approved') return { label: 'Approved', color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500' };
                      return { label: 'Open', color: 'text-slate-600', bg: 'bg-slate-50', dot: 'bg-slate-400' };
                    };

                    const isAuditClosed = call.status_label === 'Closed';
                    const displayStatus = (isAuditClosed && call.rejected_at) ? 'Rejected' : ((isAuditClosed && call.approved_at) ? 'Approved' : (call.status_label || 'Open Unallocated'));
                    const style = getStatusStyle(displayStatus);

                    return (
                      <div className={`inline-flex flex-col items-start gap-1 ${style.bg} ${style.color} px-2.5 py-1.5 rounded-lg border border-current/10 min-w-[140px] shadow-sm`}>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          <span className="text-[10px] font-bold uppercase tracking-tight leading-none">
                            {displayStatus === 'Approved' ? 'Closed - Approved' :
                              displayStatus === 'Rejected' ? 'Closed - Rejected' :
                                displayStatus === 'Tech. Solve Call' ? 'Tech Solved' :
                                (displayStatus.includes('Assigned') || displayStatus.includes('Allocated')) ? 'Assigned' :
                                  displayStatus}
                          </span>
                        </div>
                        {(call.approved_at || call.rejected_at || (call.status_label === 'Closed' && call.resolved_at)) && (
                          <span className="text-[9px] opacity-70 font-medium">
                            {new Date(call.approved_at || call.rejected_at || call.resolved_at).toLocaleDateString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {call.status_label === 'Assigned - Acceptance Pending' && !call.rejected_at && !call.approved_at && (
                          <span className="text-[9px] opacity-70 font-medium">Assigned to Tech</span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <span className="text-[12px] text-[#64748b] truncate">
                      {call.engineer_name || 'Unassigned'}
                    </span>
                    <div className="flex items-center gap-1.5 opacity-60">
                      {call.visit_count > 0 && (
                        <Tooltip content={`${call.visit_count} Visits`}>
                          <Wrench size={12} className="text-blue-500" />
                        </Tooltip>
                      )}
                      {call.part_count > 0 && (
                        <Tooltip content={`${call.part_count} Parts Used`}>
                          <Package size={12} className="text-amber-500 fill-amber-50" />
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col gap-1.5 items-center">
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full uppercase transition-colors"
                      style={{ background: colors.bg, color: colors.text }}
                    >
                      {currentAudit === 'unseen' ? 'Unseen' : currentAudit === 'noted' ? 'Verified' : currentAudit === 'query' ? 'Hold' : 'Rejected'}
                    </span>
                    {call.comments?.length > 0 && (
                      <div className="flex items-center gap-1 opacity-60">
                        <MessageSquare size={12} className="text-rose-500" />
                        <span className="text-[10px] text-slate-400 font-medium">{call.comments.length}</span>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
        );
          })}
      </tbody>
    </table>
    </div >
  );
});
