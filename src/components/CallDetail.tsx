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
  const [isMobile, setIsMobile] = useState(false);

  // Swipe & Reason Prompt State
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [pendingAction, setPendingAction] = useState<'none' | 'reject' | 'hold'>('none');
  const [reason, setReason] = useState('');

  if (!call) return null;

  // Detect mobile
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  const handleStatusUpdate = (flag: string, customReason?: string) => {
    const isMandatory = flag === 'query' || flag === 'escalate';
    const finalNote = customReason || note;
    const recentComment = (Date.now() - lastCommentedAt) < 120000;

    if (isMandatory && !finalNote.trim() && !recentComment) {
      if (isMobile) {
        setPendingAction(flag === 'query' ? 'hold' : 'reject');
        return;
      }
      setErrorType(flag === 'query' ? 'hold' : 'reject');
      const toastFn = flag === 'query' ? toast.warning : toast.error;
      toastFn(`Mandatory: Please explain why you are ${flag === 'query' ? 'holding' : 'rejecting'} this ticket.`, {
        description: "Type your reason in the Notes box and click again.",
      });
      return;
    }

    setErrorType('none');
    if (finalNote.trim()) {
      const prefix = flag === 'query' ? '[HOLD] ' : flag === 'escalate' ? '[REJECT] ' : '[APPROVE] ';
      onPostComment(call.ncode, prefix + finalNote);
      setNote('');
      setReason('');
      setPendingAction('none');
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

  // Swipe Handlers
  const minSwipeDistance = 70;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const current = e.targetTouches[0].clientX;
    setTouchEnd(current);
    setSwipeOffset(current - touchStart);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      setSwipeOffset(0);
      return;
    }
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      // Left Swipe = Approved (User request: left swipe means approved)
      handleStatusUpdate('noted');
    } else if (isRightSwipe) {
      // Right Swipe = Rejected (User request: right swipe means rejected)
      setPendingAction('reject');
    }

    setSwipeOffset(0);
    setTouchStart(null);
    setTouchEnd(null);
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

  React.useEffect(() => {
    setActiveTab('details');
    setNote('');
    setReason('');
    setPendingAction('none');
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

  return (
    <div
      className="flex flex-col h-full bg-white font-sans w-full overflow-hidden relative"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Swipe Feedback Overlay */}
      {Math.abs(swipeOffset) > 20 && (
        <div
          className={`absolute inset-0 z-[150] flex items-center justify-center pointer-events-none transition-opacity duration-200 ${Math.abs(swipeOffset) > minSwipeDistance ? 'opacity-100' : 'opacity-40'}`}
          style={{
            backgroundColor: swipeOffset > 0 ? 'rgba(244, 63, 94, 0.1)' : 'rgba(16, 185, 129, 0.1)'
          }}
        >
          <div className={`p-6 rounded-full bg-white shadow-2xl scale-[1.5] transition-transform ${Math.abs(swipeOffset) > minSwipeDistance ? 'scale-[2]' : ''}`}>
            {swipeOffset > 0 ? <XCircle size={32} className="text-rose-500" /> : <CheckCircle size={32} className="text-emerald-500" />}
          </div>
          <div className="absolute bottom-24 text-[14px] font-black uppercase tracking-widest text-slate-900 bg-white px-4 py-2 rounded-full shadow-lg">
            {swipeOffset > 0 ? 'Swipe Right to Reject' : 'Swipe Left to Approve'}
          </div>
        </div>
      )}

      {/* Reason Prompt Modal */}
      {pendingAction !== 'none' && (
        <div className="absolute inset-0 z-[200] bg-slate-900/60 flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-xl ${pendingAction === 'reject' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg font-black text-slate-900">
                {pendingAction === 'reject' ? 'Rejection Reason' : 'Hold Reason'}
              </h3>
            </div>
            <textarea
              autoFocus
              className="w-full h-32 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:border-slate-400 transition-all resize-none mb-4"
              placeholder={`Why are you ${pendingAction === 'reject' ? 'rejecting' : 'holding'} this ticket?`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingAction('none'); setReason(''); }}
                className="flex-1 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStatusUpdate(pendingAction === 'reject' ? 'escalate' : 'query', reason)}
                disabled={!reason.trim()}
                className={`flex-1 py-4 text-sm font-black text-white rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 ${pendingAction === 'reject' ? 'bg-rose-600 shadow-rose-100' : 'bg-amber-500 shadow-amber-100'
                  }`}
              >
                Confirm {pendingAction === 'reject' ? 'Reject' : 'Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Overlay */}
      {previewImage && (
        <div
          className="absolute inset-0 z-[210] bg-slate-900/90 flex items-center justify-center p-8 animate-in fade-in duration-200"
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
                >
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
            <h1 className="text-[20px] lg:text-[22px] font-black text-slate-900 leading-tight">
              {call.customer_name}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col border-r border-slate-100 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-100 px-4 lg:px-6 scrollbar-hide">
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
                className={`flex items-center gap-1 px-4 py-3.5 text-[13px] font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${activeTab === t.id
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

          <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
            {activeTab === 'details' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-5">
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

                {isMobile && (
                  <div className="space-y-2 border-t border-slate-50 pt-6">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Lifecycle Timeline</div>
                    <div className="bg-slate-50/50 p-4 rounded-2xl space-y-3">
                      <TimelineItem label="Logged" date={call.logged_at} />
                      {call.started_at && <TimelineItem label="Started" date={call.started_at} />}
                      {call.resolved_at && <TimelineItem label="Solved" date={call.resolved_at} highlight />}
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'visits' && (
              <div className="space-y-4">
                {(call.visits || []).length > 0 ? (
                  call.visits.map((v: any, i: number) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-900">Visit #{i + 1}</span>
                        <span className="text-[11px] font-bold text-slate-400">
                          {v.dvisitdatetime ? new Date(v.dvisitdatetime).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                      <div className="text-[13px] text-slate-600 italic">
                        {v.vvisitremark || v.vcustomerRemarks || 'No visit description.'}
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
                      <div className="p-3.5 flex items-center justify-between bg-white">
                        <div className="text-[13px] font-bold text-slate-900">{p.vpartname}</div>
                        <div className="text-[14px] font-black text-slate-900">x{p.nqty || 1}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No parts recorded</div>
                )}
              </div>
            )}

            {activeTab === 'images' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {allImages.map((img, i) => (
                  <ImageCard key={i} img={img} onPreview={() => setPreviewImage(img.url)} onLoaded={() => handleImageLoad(img.url)} />
                ))}
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="space-y-4">
                {(call.comments || []).map((c: any, i: number) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold uppercase">{c.author_name?.charAt(0)}</div>
                    <div className="flex-1 text-[13px]">
                      <div className="font-bold text-slate-900">{c.author_name}</div>
                      <div className="text-slate-600 mt-1">{c.comment}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Stats & Sidebar (Hidden on Mobile, Integrated in Tabs/Footer) */}
        {!isMobile && (
          <div className="w-[280px] flex flex-col p-6 space-y-6 overflow-y-auto">
            <div className="space-y-2 pb-4 border-b border-slate-50">
              <TimelineItem label="Logged" date={call.logged_at} />
              {call.started_at && <TimelineItem label="Started" date={call.started_at} />}
              {call.resolved_at && <TimelineItem label="Solved" date={call.resolved_at} highlight />}
            </div>

            <div className="flex-1 flex flex-col space-y-2">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Notes / query</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add observations..."
                className="flex-1 w-full bg-white border border-slate-200 rounded-lg p-3 text-[13px] outline-none resize-none focus:border-slate-400"
              />
              <button
                onClick={handlePostComment}
                disabled={!note.trim()}
                className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm font-bold disabled:opacity-30"
              >
                Post Comment
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Footer Actions */}
      <div className="px-4 py-4 border-t border-slate-100 flex items-center gap-2 bg-white pb-safe">
        <button
          onClick={() => handleStatusUpdate('noted')}
          className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl text-[13px] font-black uppercase tracking-widest"
        >
          Approve
        </button>
        <button
          onClick={() => setPendingAction('hold')}
          className="px-6 py-3.5 bg-slate-50 text-slate-600 rounded-2xl text-[13px] font-bold border border-slate-200"
        >
          Hold
        </button>
        <button
          onClick={() => setPendingAction('reject')}
          className="px-6 py-3.5 bg-rose-50 text-rose-600 rounded-2xl text-[13px] font-bold border border-rose-100"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ImageCard({ img, onPreview, onLoaded }: { img: any; onPreview: () => void; onLoaded: () => void }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error) return null;

  return (
    <div className="relative aspect-square cursor-pointer overflow-hidden rounded-xl border border-slate-100 bg-slate-50" onClick={onPreview}>
      <img
        src={img.url}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => { setLoading(false); onLoaded(); }}
        onError={() => setError(true)}
      />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-slate-50 animate-pulse"><Image size={20} className="text-slate-200" /></div>}
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
    <div className="flex justify-between items-start text-[12px] lg:text-[13px] py-0.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <div className="text-right">
        <div className={`${colors[status || 'default']} font-bold leading-none`}>
          {date ? new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
        </div>
        {date && <div className="text-[10px] text-slate-400 mt-0.5">{new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>}
      </div>
    </div>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="w-full">
      <div className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1">{label}</div>
      <div className={`text-[13px] font-bold leading-tight ${muted ? 'text-slate-300' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}
