'use client';

import React, { useState } from 'react';
import { 
  MessageSquare, Send, CheckCircle2, AlertCircle, 
  XCircle, Package, Clock, ShieldCheck 
} from 'lucide-react';
import { Tooltip } from './Tooltip';

interface CallCardProps {
  call: any;
  onFlagUpdate: (id: string, flag: string) => void;
  onPostComment: (id: string, text: string) => void;
  onCopy?: (text: string) => void;
  isMobile?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  activeTab?: string;
}

export function CallCard({ call, onFlagUpdate, onPostComment, onCopy, isMobile, selected, onSelect, activeTab }: CallCardProps) {
  const [commentText, setCommentText] = useState('');
  const [copied, setCopied] = useState(false);
  const callId = call.id || call.ncode;
  const flag = call.audit_flag || call.flag;
  const status = call.status_label || call.review_status || call.callStatus || 'Service Call';

  const auditColors = {
    noted: { bg: "#f0fdf4", text: "#16a34a" },
    query: { bg: "#fffbeb", text: "#d97706" },
    escalate: { bg: "#fff1f2", text: "#e11d48" },
    unseen: { bg: "#f1f5f9", text: "#94a3b8" }
  };

  const currentAudit = flag || 'unseen';
  const colors = auditColors[currentAudit as keyof typeof auditColors];

  const handlePost = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!commentText.trim()) return;
    onPostComment(callId, commentText);
    setCommentText('');
  };

  const statusColor = 
    status === 'Cancelled Call' ? 'text-rose-500' : 
    status === 'Tech. Solve Call' ? 'text-blue-600' :
    status === 'Open Unallocated' ? 'text-amber-500' :
    status === 'Closed' ? 'text-emerald-600' :
    'text-slate-900';

  return (
    <div 
      className="bg-white border border-[#f1f5f9] rounded-xl p-3.5 shadow-sm active:scale-[0.98] transition-all cursor-pointer"
      onClick={() => onSelect?.(callId)}
    >
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2">
          <Tooltip content={copied ? "Copied!" : "Click to Copy"}>
            <span 
              className="text-[11px] text-[#94a3b8] font-mono uppercase bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 cursor-pointer active:bg-slate-200 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(call.vtrnno || call.vtransfercallno);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {call.vtrnno || call.vtransfercallno || 'N/A'}
            </span>
          </Tooltip>
          {activeTab === 'all' && call.is_major_repair === 'True' && (
            <span className="text-[9px] font-black bg-rose-500 text-white px-1.5 py-0.5 rounded-sm tracking-tighter shadow-sm animate-pulse">
              MAJOR
            </span>
          )}
          {call.part_count > 0 && (
            <Package size={12} className="text-amber-500 fill-amber-50" />
          )}
        </div>
        <span 
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase"
          style={{ background: colors.bg, color: colors.text }}
        >
          {currentAudit === 'unseen' ? 'Unseen' : currentAudit === 'noted' ? 'Verified' : currentAudit === 'query' ? 'Hold' : 'Rejected'}
        </span>
      </div>
      
      <div className="text-[14px] font-semibold text-[#0f172a] mb-0.5 leading-tight">
        {call.customer_name}
      </div>
      <div className="text-[11px] text-[#94a3b8] mb-2 font-normal">
        {call.branch_name}
      </div>

      <div className="text-[12px] text-[#64748b] font-normal italic mb-2.5 line-clamp-1">
        "{call.vcomplaint || '—'}"
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-[#f8fafc]">
        <span className="text-[11px] text-[#94a3b8]">
          {call.logged_at ? new Date(call.logged_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '09:49 AM'}
        </span>
        <span className="text-[11px] text-[#94a3b8] font-medium">
          {call.engineer_name || 'Unassigned'}
        </span>
      </div>
    </div>
  );
}
