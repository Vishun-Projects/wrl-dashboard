'use client';

import React, { useState } from 'react';
import { X, AlertCircle, Send, Image, ExternalLink, Package, MessageSquare, ArrowRight, Wrench, Copy, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface CallDetailProps {
  call: any;
  onClose: () => void;
  onFlagUpdate: (id: string, flag: string) => void;
  onPostComment: (id: string, text: string) => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  currentIndex?: number;
  totalCount?: number;
}

export function CallDetail({ call, onClose, onFlagUpdate, onPostComment, onNext, onPrev, hasNext, hasPrev, currentIndex, totalCount }: CallDetailProps) {

  const [activeTab, setActiveTab] = useState<'details' | 'visits' | 'parts' | 'comments' | 'images'>('details');
  const [note, setNote] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [errorType, setErrorType] = useState<'none' | 'hold' | 'reject'>('none');
  const [lastCommentedAt, setLastCommentedAt] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  if (!call) return null;

  // 1. Unified Image Collection
  const allImages: any[] = [];
  (call.documents || []).forEach((d: any) => {
    if (d.filename && d.filename.trim()) {
      allImages.push({
        url: `https://westerncrm.com/WRL/UploadDocs/${d.office_id}/${d.filename.trim()}`,
        title: d.remarks || d.original_name
      });
    }
  });

  const handleImageLoad = (url: string) => {
    setLoadedImages(prev => new Set(prev).add(url));
  };

  const handleStatusUpdate = (flag: string) => {
    const isMandatory = flag === 'query' || flag === 'escalate';
    const recentComment = (Date.now() - lastCommentedAt) < 120000; // 2 minutes window

    if (isMandatory && !note.trim() && !recentComment) {
      setErrorType(flag === 'query' ? 'hold' : 'reject');
      const toastFn = flag === 'query' ? toast.warning : toast.error;
      toastFn(`Mandatory: Please explain why you are ${flag === 'query' ? 'holding' : 'rejecting'} this ticket.`, {
        description: "Type your reason in the Notes box and click again.",
      });
      return;
    }

    setErrorType('none');
    if (note.trim()) {
      const prefix = flag === 'query' ? '[HOLD] ' : flag === 'escalate' ? '[REJECT] ' : '[APPROVE] ';
      onPostComment(call.ncode, prefix + note);
      setNote('');
      setLastCommentedAt(Date.now());
    }

    onFlagUpdate(call.ncode, flag);

    if (flag === 'noted') {
      toast.success("Success: Ticket Approved and Closed");
      if (onNext) onNext(); else onClose();
    } else if (flag === 'query') {
      toast.warning("Status Updated: Ticket placed on Hold");
      if (onNext) onNext();
    } else if (flag === 'escalate') {
      toast.error("Status Updated: Ticket Rejected");
      if (onNext) onNext();
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

      if (e.shiftKey) {
        const key = e.key.toUpperCase();
        if (key === 'A') handleStatusUpdate('noted');
        if (key === 'H') handleStatusUpdate('query');
        if (key === 'R') handleStatusUpdate('escalate');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [note, lastCommentedAt, call]);

  // Reset internal state when call changes (Carousel support)
  React.useEffect(() => {
    setActiveTab('details');
    setNote('');
    setLoadedImages(new Set());
    setErrorType('none');
  }, [call?.ncode]);

  const currentFlag = call.audit_flag || call.flag;

  const handlePostComment = () => {
    if (!note.trim()) return;
    onPostComment(call.ncode, note);
    setNote('');
    setLastCommentedAt(Date.now());
    setErrorType('none');
    toast.success("Comment added to trail");
    setActiveTab('comments');
  };

  const hasVal = (val: any) => val && val !== '0' && val !== '0.00' && val !== 'UNKNOWN CONTACT' && val !== 'N/A';

  const isCancelled = call.ncancelreason && call.ncancelreason !== '';
  const isResolved = call.bsolved === 'True';

  // High-fidelity status logic aligned with standardized labels
  const getStatus = () => {
    const label = call.status_label || 'Open Unallocated';

    if (label === 'Cancelled Call') return { label: 'Cancelled', color: 'text-rose-500', bg: 'bg-rose-50' };
    if (label === 'Closed') return { label: 'Closed', color: 'text-slate-500', bg: 'bg-slate-50' };
    if (label === 'Tech. Solve Call') return { label: 'Tech. Solve', color: 'text-emerald-600', bg: 'bg-emerald-50' };
    if (label === 'Allocated - Accepted') return { label: 'Allocated', color: 'text-cyan-600', bg: 'bg-cyan-50' };
    if (label.includes('Assigned')) return { label: 'Assigned', color: 'text-blue-600', bg: 'bg-blue-50' };

    return { label: 'Open Unallocated', color: 'text-amber-500', bg: 'bg-amber-50' };
  };

  const status = getStatus();

  return (
    <div className="flex flex-col h-full bg-white font-sans w-full overflow-hidden relative">
      {/* Image Preview Overlay */}
      {previewImage && (
        <div
          className="absolute inset-0 z-[200] bg-slate-900/90 flex items-center justify-center p-8 animate-in fade-in duration-200"
          onClick={() => setPreviewImage(null)}
        >
          <button className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors">
            <X size={32} />
          </button>
          <img
            src={previewImage}
            className="max-w-full max-h-full object-contain shadow-2xl rounded-lg animate-in zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Background Image Validator for accurate counts */}
      <div className="hidden" aria-hidden="true">
        {allImages.map((img, i) => (
          <img
            key={i}
            src={img.url}
            onLoad={() => handleImageLoad(img.url)}
            onError={() => { /* Error handled by ImageCard locally */ }}
          />
        ))}
      </div>

      {/* Header Area */}
      <div className="px-6 py-4 flex-shrink-0 border-b border-slate-100 bg-white">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-1">
              <div className="text-[12px] text-slate-400 font-medium">
                {call.vtrnno || call.vtransfercallno} · {call.status_label || 'Service Call'}
              </div>
              <div className="flex items-center bg-slate-900 text-white rounded-full px-2 py-0.5 border border-slate-800 shadow-lg">
                <button 
                  onClick={onPrev} 
                  disabled={!hasPrev}
                  className="p-1 hover:text-blue-400 disabled:opacity-20 transition-all"
                  title="Previous (Shift + P)"
                >
                  <ArrowRight size={12} className="rotate-180" />
                </button>
                <div className="px-2 text-[10px] font-black tracking-tighter border-x border-slate-800 mx-1 min-w-[50px] text-center uppercase">
                  {typeof currentIndex === 'number' ? `${currentIndex + 1} of ${totalCount}` : 'Navigate'}
                </div>
                <button 
                  onClick={onNext} 
                  disabled={!hasNext}
                  className="p-1 hover:text-blue-400 disabled:opacity-20 transition-all"
                  title="Next (Shift + N)"
                >
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
            <h1 className="text-[22px] font-black text-slate-900 leading-tight">
              {call.customer_name}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {(() => {
              const getHeaderStatus = (label: string) => {
                if (label.includes('Assigned') || label.includes('Allocated')) return { label: 'Assigned', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
                if (label === 'Tech. Solve Call') return { label: 'Tech. Solve', bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' };
                if (label === 'Closed' || label === 'Approved') return { label: 'Approved', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' };
                if (label === 'Rejected') return { label: 'Rejected', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' };
                return { label: 'Open', bg: 'bg-slate-50', text: 'text-slate-500', border: 'border-slate-200' };
              };

              const currentStatusLabel = (call.status_label === 'Closed' && call.rejected_at) ? 'Rejected' :
                ((call.status_label === 'Closed' && call.approved_at) ? 'Approved' : (call.status_label || 'Open Unallocated'));

              const style = getHeaderStatus(currentStatusLabel);

              return (
                <div className={`flex items-center gap-2 px-3 py-1.5 ${style.bg} ${style.text} border ${style.border} rounded-lg animate-in fade-in zoom-in-95 duration-300`}>
                  <CheckCircle size={14} className="opacity-70" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">{style.label}</span>
                </div>
              );
            })()}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all relative"
                title="Keyboard Shortcuts"
              >
                <span className="flex items-center justify-center w-5 h-5 border-2 border-slate-300 rounded-full text-[10px] font-black">?</span>
                {showHelp && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-slate-900 text-white p-3 rounded-xl shadow-2xl z-[50] text-left animate-in fade-in zoom-in-95">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Shortcuts</div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-medium"><span className="text-slate-500">Shift + A</span> <span>Approve</span></div>
                      <div className="flex justify-between text-[11px] font-medium"><span className="text-slate-500">Shift + H</span> <span>Hold</span></div>
                      <div className="flex justify-between text-[11px] font-medium"><span className="text-slate-500">Shift + R</span> <span>Reject</span></div>
                      <div className="flex justify-between text-[11px] font-medium"><span className="text-slate-500">Ctrl + Enter</span> <span>Post Note</span></div>
                    </div>
                  </div>
                )}
              </button>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Main Content */}
        <div className="flex-1 flex flex-col border-r border-slate-100 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-100 px-6">
            {[
              { id: 'details', label: 'Details' },
              { id: 'visits', label: 'Visits', count: call.visits?.length || 0 },
              { id: 'parts', label: 'Parts', count: call.parts?.length || 0 },
              { id: 'images', label: 'Images', count: allImages.length },
              { id: 'comments', label: 'Comments', count: call.comments?.length || 0 },
            ].map((t: any) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1 px-4 py-3.5 text-[13px] font-medium transition-all border-b-2 -mb-px ${activeTab === t.id
                  ? 'text-slate-900 border-slate-900'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
                  }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={`text-[10px] rounded-md px-1.5 py-0.5 min-w-[20px] text-center font-bold ${activeTab === t.id ? 'bg-slate-100 text-slate-900' : 'bg-slate-50 text-slate-400'
                    } border border-slate-200`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {activeTab === 'details' && (
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-x-10 gap-y-5">
                  <Field label="Serial no." value={call.vserialno || '—'} muted={!call.vserialno} />
                  <Field label="Client ticket" value={call.vmanualjobno || '—'} muted={!call.vmanualjobno} />
                  <Field label="Technician" value={call.engineer_name || 'Unassigned'} muted={!call.engineer_name} />
                  <Field label="Branch / Franchisee" value={call.vlocation || call.branch_name} />
                  <Field label="Reported by" value={call.vpersoncalling || 'Not recorded'} muted={!call.vpersoncalling} />
                  <Field label="Category" value={call.npriority === '1' ? 'Major (Service)' : 'Minor (Installation)'} />
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Complaint</div>
                  <div className="p-3.5 bg-slate-50 rounded-lg text-[13px] text-slate-500 italic border border-slate-100">
                    {call.complaint_label || 'No description provided'}
                  </div>
                </div>

                {(call.crm_reject || call.cancel_reason) && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl space-y-2 animate-in fade-in slide-in-from-top-1">
                    <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                      <XCircle size={14} className="text-rose-500" /> CRM Rejection Details
                    </div>
                    <div className="text-[14px] text-rose-900 font-bold leading-tight">
                      {call.crm_reject_reason || call.cancel_reason || 'Rejection recorded in CRM'}
                    </div>
                    {(call.crm_reject_at || call.resolved_at) && (
                      <div className="text-[10px] text-rose-400 font-medium">
                        Processed in CRM on {new Date(call.crm_reject_at || call.resolved_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'visits' && (
              <div className="space-y-6">
                {(call.visits || []).length > 0 ? (
                  call.visits.map((v: any, i: number) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-900">Visit #{i + 1}</span>
                        <span className="text-[11px] font-bold text-slate-400">
                          {v.dvisitdatetime ? new Date(v.dvisitdatetime).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                        </span>
                      </div>
                      <div className="text-[13px] text-slate-600 leading-relaxed mb-4">
                        {v.vvisitremark || v.vcustomerRemarks || (
                          <span className="text-slate-300 italic">No visit description.</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No visits recorded</div>
                )}
              </div>
            )}

            {activeTab === 'parts' && (
              <div className="space-y-3">
                {(call.parts || []).length > 0 ? (
                  call.parts.map((p: any, i: number) => (
                    <div key={i} className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                      <div className="p-3.5 flex items-center justify-between bg-white border-b border-slate-100">
                        <div>
                          <div className="text-[13px] font-bold text-slate-900">{p.vpartname}</div>
                          <div className="text-[11px] text-slate-400 font-medium">{p.vpartcode}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[14px] font-black text-slate-900">x{p.nqty || 1}</div>
                          <div className={`text-[10px] font-bold uppercase tracking-tighter px-2 py-0.5 rounded ${p.bclaimed === 'True' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {p.bclaimed === 'True' ? 'Warranty' : 'Paid'}
                          </div>
                        </div>
                      </div>
                      <div className="p-3 grid grid-cols-2 gap-3">
                        {p.vnewbarcode && (
                          <div className="space-y-1">
                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">New Barcode</div>
                            <div className="bg-amber-50 text-amber-900 text-[11px] font-mono font-bold px-2.5 py-1.5 rounded-lg border border-amber-100 shadow-sm flex items-center gap-2">
                              <Package size={12} className="text-amber-500" />
                              {p.vnewbarcode}
                            </div>
                          </div>
                        )}
                        {p.voldbarcode && (
                          <div className="space-y-1">
                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Old Barcode</div>
                            <div className="bg-slate-100 text-slate-600 text-[11px] font-mono font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2">
                              <Package size={12} className="text-slate-400" />
                              {p.voldbarcode}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No parts recorded</div>
                )}
              </div>
            )}

            {activeTab === 'images' && (
              <div className="grid grid-cols-3 gap-3">
                {allImages.length === 0 ? (
                  <div className="col-span-3 py-16 text-center text-slate-400 text-[13px]">No images found</div>
                ) : (
                  allImages.map((img, i) => (
                    <ImageCard key={i} img={img} onPreview={() => setPreviewImage(img.url)} onLoaded={() => handleImageLoad(img.url)} />
                  ))
                )}
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="flex flex-col h-full">
                <div className="flex-1 space-y-4 mb-4">
                  {(call.comments || []).length > 0 ? (
                    (call.comments || []).map((c: any, i: number) => (
                      <div key={i} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-500 uppercase">{c.author_name?.charAt(0)}</div>
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-[13px] font-bold text-slate-900">{c.author_name}</span>
                            <span className="text-[10px] text-slate-400">{new Date(c.created_at).toLocaleDateString()}</span>
                            {c.comment.includes('[HOLD]') && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded border border-amber-100 uppercase">Hold</span>}
                            {c.comment.includes('[REJECT]') && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded border border-rose-100 uppercase">Reject</span>}
                            {c.comment.includes('[APPROVE]') && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded border border-emerald-100 uppercase">Approve</span>}
                          </div>
                          <div className="text-[13px] text-slate-600 leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100/50">
                            {c.comment.replace(/\[(HOLD|REJECT|APPROVE)\]\s*/g, '')}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No comments yet</div>
                  )}
                </div>

                {/* Input removed as it is now centralized in the sidebar */}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Stats & Sidebar */}
        <div className="w-[280px] flex flex-col p-6 space-y-6 overflow-y-auto">
          <div className="space-y-2 pb-4 border-b border-slate-50">
            <TimelineItem label="Logged" date={call.logged_at} />
            {call.started_at && <TimelineItem label="Started" date={call.started_at} />}
            {call.resolved_at && <TimelineItem label="Solved" date={call.resolved_at} highlight />}

            {call.rejected_at ? (
              <div className="space-y-1">
                <TimelineItem label="Rejected" date={call.rejected_at} status="danger" />
                {call.reject_reason && (
                  <div className="text-[11px] text-rose-500 bg-rose-50/50 p-2 rounded border border-rose-100/50 italic leading-snug">
                    "{call.reject_reason}"
                  </div>
                )}
              </div>
            ) : call.approved_at ? (
              <TimelineItem label="Approved" date={call.approved_at} status="success" />
            ) : null}
          </div>


          <div className="flex-1 flex flex-col space-y-2 relative">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Notes / query</div>
            <div className="flex-1 relative flex flex-col">
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (errorType !== 'none') setErrorType('none');
                }}
                placeholder="Add observations or hold reason..."
                className={`flex-1 w-full bg-white border rounded-lg p-3 pb-12 text-[13px] text-slate-700 placeholder:text-slate-300 outline-none resize-none transition-all ${errorType === 'hold'
                  ? 'border-amber-400 bg-amber-50/30 ring-2 ring-amber-100'
                  : errorType === 'reject'
                    ? 'border-rose-400 bg-rose-50/30 ring-2 ring-rose-100'
                    : 'border-slate-200 focus:border-slate-400 shadow-sm'
                  }`}
                onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handlePostComment()}
              />
              <button
                onClick={handlePostComment}
                disabled={!note.trim()}
                className={`absolute bottom-2 right-2 p-2 rounded-lg transition-all ${errorType === 'hold' ? 'bg-amber-500 text-white animate-pulse' :
                  errorType === 'reject' ? 'bg-rose-500 text-white animate-pulse' :
                    'bg-slate-900 text-white hover:bg-slate-800'
                  } disabled:opacity-30 disabled:bg-slate-400`}
                title="Post comment (Ctrl + Enter)"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="px-6 py-4 border-t border-slate-100 flex items-center gap-2 bg-white">
        <button
          onClick={() => handleStatusUpdate('noted')}
          className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-all active:scale-[0.98] ${currentFlag === 'noted'
            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100'
            : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
        >
          {currentFlag === 'noted' ? '✓ Approved' : 'Approve & close'}
        </button>
        <button
          onClick={() => handleStatusUpdate('query')}
          className={`px-6 py-2.5 rounded-lg text-[13px] font-medium transition-all active:scale-[0.98] border ${currentFlag === 'query'
            ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
        >
          {currentFlag === 'query' ? 'On Hold' : 'Hold'}
        </button>
        <button
          onClick={() => handleStatusUpdate('escalate')}
          className={`px-6 py-2.5 rounded-lg text-[13px] font-medium transition-all active:scale-[0.98] border ${currentFlag === 'escalate'
            ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-sm'
            : 'bg-white border-rose-100 text-rose-600 hover:bg-rose-50'
            }`}
        >
          {currentFlag === 'escalate' ? 'Rejected' : 'Reject'}
        </button>
      </div>
    </div>
  );
}

function ImageCard({ img, onPreview, onLoaded }: { img: any; onPreview: () => void; onLoaded: () => void }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleLoad = () => {
    setLoading(false);
    onLoaded();
  };

  if (error) return null;

  return (
    <div className="group relative cursor-pointer" onClick={onPreview}>
      <div className="aspect-square bg-slate-50 rounded-lg border border-slate-100 overflow-hidden flex items-center justify-center relative">
        <img
          src={img.url}
          className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${loading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={handleLoad}
          onError={() => setError(true)}
        />
        {(loading || error) && <Image size={24} className="text-slate-200 absolute animate-pulse" />}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="p-2 bg-white rounded-full text-slate-900 shadow-xl"><ExternalLink size={16} /></div>
        </div>
      </div>
      <div className="text-[10px] text-slate-400 mt-1.5 truncate text-center font-medium group-hover:text-slate-900 transition-colors">{img.title}</div>
    </div>
  );
}

function TimelineItem({ label, date, highlight, status }: { label: string; date: string; highlight?: boolean; status?: 'success' | 'danger' }) {
  const colors = {
    success: 'text-emerald-600',
    danger: 'text-rose-600',
    default: highlight ? 'text-indigo-600' : 'text-slate-900'
  };

  return (
    <div className="flex justify-between items-start text-[13px] py-0.5">
      <span className="text-slate-400">{label}</span>
      <div className="text-right">
        <div className={`${colors[status || 'default']} font-bold leading-none`}>
          {date ? new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
        </div>
        {date && (
          <div className="text-[10px] text-slate-400 font-medium mt-0.5">
            {new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="w-full">
      <div className="text-[10px] text-[#94a3b8] uppercase font-bold tracking-wider mb-0.5">{label}</div>
      <div className={`text-[13px] font-semibold leading-tight break-words ${muted ? 'text-[#cbd5e1]' : 'text-[#0f172a]'}`}>
        {value}
      </div>
    </div>
  );
}
