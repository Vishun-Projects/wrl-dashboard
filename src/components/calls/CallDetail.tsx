'use client';

import React, { useState } from 'react';
import NextImage from 'next/image';
import { X, AlertCircle, Send, Image as ImageIcon, Wrench, CheckCircle, XCircle, Clock, UserCheck } from 'lucide-react';
import { feedback } from '@/lib/ui/feedback';
import { ImagePreviewViewer } from '@/components/shared/ImagePreviewViewer';
import { PartBarcodeImages } from '@/components/calls/PartBarcodeImages';
import {
  buildCallImages,
  buildReplacementPartViews,
  isSerialTrackedReplacementPart,
} from '@/lib/calls/part-barcode-images';
import type { CallDocument, CallPart } from '@/lib/calls/part-barcode-images';
import { resolveAvatarDisplayUrl } from '@/lib/auth/avatar-url';
import { formatUiDate, formatUiDateTime } from '@/lib/dates/ui-date';

type CallComment = {
  comment?: string;
  author_name?: string;
  author_avatar_url?: string;
  created_at?: string;
};

type CallHistoryEvent = Record<string, unknown> & {
  cancel_reason?: string;
  cancel_reason_label?: string;
  bsolved?: boolean;
  bBMreject?: boolean;
  bfastclose?: boolean;
  baccepted?: boolean;
  nengineer?: string | number;
  vcomment?: string;
  vBMrejectreason?: string;
};

type CallDetailData = Record<string, unknown> & {
  ncode: string;
  comments?: CallComment[];
  documents?: CallDocument[];
  parts?: CallPart[];
  visits?: Record<string, unknown>[];
  faults?: Record<string, unknown>[];
  history?: CallHistoryEvent[];
};

interface CallDetailProps {
  call: CallDetailData;
  onClose: () => void;
  onFlagUpdate: (id: string, flag: string) => void | Promise<void>;
  onPostComment: (id: string, text: string) => void | Promise<void>;
  onNext?: () => void;
}

const getHistoryEventMeta = (h: CallHistoryEvent) => {
  let statusLabel = 'Open Unallocated';
  let color = 'text-amber-500 bg-amber-50 border-amber-200';
  let icon = <Clock className="w-4 h-4 text-amber-500" />;

  if (h.cancel_reason_label || (h.cancel_reason && h.cancel_reason !== '0')) {
    statusLabel = h.cancel_reason_label || 'Cancelled';
    color = 'text-rose-500 bg-rose-50 border-rose-200';
    icon = <XCircle className="w-4 h-4 text-rose-500" />;
  }
  else if (h.bsolved) {
    const isRejected = h.bBMreject;
    statusLabel = isRejected ? 'Closed - Rejected' : 'Closed';
    color = isRejected ? 'text-rose-500 bg-rose-50 border-rose-200' : 'text-emerald-500 bg-emerald-50 border-emerald-200';
    icon = isRejected ? <XCircle className="w-4 h-4 text-rose-500" /> : <CheckCircle className="w-4 h-4 text-emerald-500" />;
  }
  else if (h.bfastclose) {
    statusLabel = 'Tech. Solve Call';
    color = 'text-indigo-500 bg-indigo-50 border-indigo-200';
    icon = <Wrench className="w-4 h-4 text-indigo-500" />;
  }
  else if (h.baccepted) {
    statusLabel = 'Allocated - Accepted';
    color = 'text-sky-500 bg-sky-50 border-sky-200';
    icon = <UserCheck className="w-4 h-4 text-sky-500" />;
  }
  else if (h.nengineer && h.nengineer !== 0 && h.nengineer !== '0') {
    statusLabel = 'Assigned - Acceptance Pending';
    color = 'text-blue-500 bg-blue-50 border-blue-200';
    icon = <Clock className="w-4 h-4 text-blue-500" />;
  }

  // Handle re-opened or branch manager rejects
  if (h.bBMreject && !h.bsolved) {
    statusLabel = 'Rejected by Branch Manager';
    color = 'text-rose-500 bg-rose-50 border-rose-200';
    icon = <AlertCircle className="w-4 h-4 text-rose-500" />;
  }

  return { statusLabel, color, icon };
};

export function CallDetail(props: CallDetailProps) {
  return <CallDetailContent key={props.call.ncode} {...props} />;
}

function CallDetailContent({ call, onClose, onFlagUpdate, onPostComment, onNext }: CallDetailProps) {

  const [activeTab, setActiveTab] = useState<'details' | 'visits' | 'faults' | 'parts' | 'comments' | 'images' | 'history'>('details');
  const [note, setNote] = useState('');
  const [previewImage, setPreviewImage] = useState<{ url: string; title?: string } | null>(null);
  const [, setLoadedImages] = useState<Set<string>>(new Set());
  const [errorType, setErrorType] = useState<'none' | 'hold' | 'reject'>('none');
  const [lastCommentedAt, setLastCommentedAt] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  // Swipe & Reason Prompt State
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [pendingAction, setPendingAction] = useState<'none' | 'reject' | 'hold'>('none');
  const [reason, setReason] = useState('');

  // Detect mobile
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Synthesize comments from branch rejection if present
  const reasonText = call.crm_reject_reason || call.reject_reason || call.vBMrejectreason;
  const displayComments: CallComment[] = [...(call.comments || [])];
  if ((call.crm_reject || call.rejected_at || call.bBMreject) && reasonText) {
    const hasCrmComment = displayComments.some((c) => c.comment === reasonText || c.comment?.includes(String(reasonText)));
    if (!hasCrmComment) {
      displayComments.unshift({
        author_name: 'Branch Manager',
        comment: `[Rejection remark] ${reasonText}`,
        created_at: call.crm_reject_at || call.rejected_at || call.dBMrejectdatetime || new Date().toISOString()
      });
    }
  }

  const allImages = buildCallImages(call.documents || []);
  const replacementPartViews = buildReplacementPartViews(call.parts || [], call.documents || []);
  const regularParts = (call.parts || []).filter((p) => !isSerialTrackedReplacementPart(p));

  const handleImageLoad = (url: string) => {
    setLoadedImages(prev => new Set(prev).add(url));
  };

  const handleStatusUpdate = React.useCallback(async (flag: string, customReason?: string) => {
    const isMandatory = flag === 'query' || flag === 'escalate';
    const finalNote = customReason || note;
    const recentComment = (Date.now() - lastCommentedAt) < 120000;

    if (isMandatory && !finalNote.trim() && !recentComment) {
      if (isMobile) {
        setPendingAction(flag === 'query' ? 'hold' : 'reject');
        return;
      }
      setErrorType(flag === 'query' ? 'hold' : 'reject');
      return;
    }

    setErrorType('none');
    try {
      if (finalNote.trim()) {
        const prefix = flag === 'query' ? '[HOLD] ' : flag === 'escalate' ? '[REJECT] ' : '[APPROVE] ';
        await onPostComment(call.ncode, prefix + finalNote);
        setNote('');
        setReason('');
        setPendingAction('none');
        setLastCommentedAt(Date.now());
      }

      await onFlagUpdate(call.ncode, flag);

      if (flag === 'noted') {
        feedback.actionSuccess('Ticket approved and closed');
        if (onNext) onNext(); else onClose();
      } else if (flag === 'query') {
        feedback.actionSuccess('Ticket placed on hold');
        if (onNext) onNext();
      } else if (flag === 'escalate') {
        feedback.actionSuccess('Ticket rejected');
        if (onNext) onNext();
      }
    } catch {
      feedback.actionFailed('Could not update ticket — please try again');
    }
  }, [call, isMobile, lastCommentedAt, note, onClose, onFlagUpdate, onNext, onPostComment]);

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
      if (previewImage) return;
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
  }, [note, lastCommentedAt, call, previewImage, handleStatusUpdate]);

  const handlePostComment = async () => {
    if (!note.trim()) return;
    try {
      await onPostComment(call.ncode, note);
      setNote('');
      setLastCommentedAt(Date.now());
      setErrorType('none');
      feedback.actionSuccess('Comment added to trail');
      setActiveTab('comments');
    } catch {
      feedback.actionFailed('Could not add comment — please try again');
    }
  };

  return (
    <div className="call-detail-root flex flex-col h-full bg-bg-canvas font-sans w-full overflow-hidden relative">
      {/* Swipe Feedback Overlay */}
      {Math.abs(swipeOffset) > 20 && (
        <div
          className={`absolute inset-0 z-[150] flex items-center justify-center pointer-events-none transition-opacity duration-200 ${Math.abs(swipeOffset) > minSwipeDistance ? 'opacity-100' : 'opacity-40'}`}
          style={{
            backgroundColor: swipeOffset > 0 ? 'rgba(244, 63, 94, 0.1)' : 'rgba(16, 185, 129, 0.1)'
          }}
        >
          <div className={`p-6 rounded-full bg-bg-canvas shadow-2xl scale-[1.5] transition-transform ${Math.abs(swipeOffset) > minSwipeDistance ? 'scale-[2]' : ''}`}>
            {swipeOffset > 0 ? <XCircle size={32} className="text-rose-500" /> : <CheckCircle size={32} className="text-emerald-500" />}
          </div>
          <div className="absolute bottom-24 text-[14px] text-slate-900 bg-bg-canvas px-4 py-2 rounded-full shadow-lg ui-strong">
            {swipeOffset > 0 ? 'Swipe Right to Reject' : 'Swipe Left to Approve'}
          </div>
        </div>
      )}

      {/* Reason Prompt Modal */}
      {pendingAction !== 'none' && (
        <div className="modal-backdrop modal-backdrop--strong absolute inset-0 z-[200] flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="call-detail-modal-surface bg-bg-canvas w-full max-w-md rounded-[32px] p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-xl ${pendingAction === 'reject' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
                <AlertCircle size={24} />
              </div>
              <h3 className="text-lg text-slate-900 ui-strong">
                {pendingAction === 'reject' ? 'Rejection Reason' : 'Hold Reason'}
              </h3>
            </div>
            <textarea
              autoFocus
              className="call-detail-textarea w-full h-32 bg-bg-soft border border-slate-200 rounded-2xl p-4 text-sm font-medium outline-none focus:border-slate-400 transition-all resize-none mb-4"
              placeholder={`Why are you ${pendingAction === 'reject' ? 'rejecting' : 'holding'} this ticket?`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setPendingAction('none'); setReason(''); }}
                className="call-detail-action call-detail-action--cancel flex-1 py-4 text-sm text-slate-500 hover:bg-bg-soft rounded-2xl transition-all ui-label"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStatusUpdate(pendingAction === 'reject' ? 'escalate' : 'query', reason)}
                disabled={!reason.trim()}
                className={`call-detail-action flex-1 py-4 text-sm text-white rounded-2xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 ${pendingAction === 'reject' ? 'call-detail-action--reject bg-rose-600 shadow-rose-100' : 'call-detail-action--hold bg-amber-500 shadow-amber-100'} ui-label`}
              >
                Confirm {pendingAction === 'reject' ? 'Reject' : 'Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage ? (
        <ImagePreviewViewer
          src={previewImage.url}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}

      {/* Header Area */}
      <div className="px-6 py-4 flex-shrink-0 border-b border-slate-100 bg-bg-canvas">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-1">
              <div className="text-[12px] text-slate-400 font-medium">
                {call.vtrnno || call.vtransfercallno} · {call.status_label || 'Service Call'}
              </div>
              {/* <div className="flex items-center bg-slate-900 text-white rounded-full px-2 py-0.5 border border-slate-800 shadow-lg">
                <button
                  onClick={onPrev}
                  disabled={!hasPrev}
                  className="p-1 hover:text-blue-400 disabled:opacity-20 transition-all"
                >
                  <ArrowRight size={12} className="rotate-180" />
                </button>
                <div className="px-2 text-[10px] border-x border-slate-800 mx-1 min-w-[50px] text-center ui-label">
                  WRL Dashboard
                </div>
                <button
                  onClick={onNext}
                  disabled={!hasNext}
                  className="p-1 hover:text-blue-400 disabled:opacity-20 transition-all"
                >
                  <ArrowRight size={12} />
                </button>
              </div> */}
            </div>
            <h1 className="text-[20px] lg:text-[22px] text-slate-900 leading-tight ui-strong">
              {call.customer_name}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-bg-soft rounded-full transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      <div
        className="flex-1 flex flex-col overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Main Content Area (Tabs & Content) */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Tabs Container - Scrollable without triggering swipe */}
          <div className="flex-1 flex flex-col border-r border-slate-100 overflow-hidden">
            {/* Tabs */}
            <div
              className="flex border-b border-slate-100 px-4 lg:px-6 scrollbar-hide touch-pan-x overflow-x-auto lg:overflow-x-hidden overflow-y-hidden flex-nowrap"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {[
                { id: 'details', label: 'Details' },
                { id: 'visits', label: 'Visits', count: call.visits?.length || 0 },
                { id: 'faults', label: 'Faults', count: call.faults?.length || 0 },
                { id: 'parts', label: 'Parts', count: call.parts?.length || 0 },
                { id: 'images', label: 'Images', count: allImages.length },
                { id: 'comments', label: 'Comments', count: displayComments.length },
                // { id: 'history', label: 'History', count: call.history?.length || 0 },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`call-detail-tab flex items-center gap-1 px-4 py-3.5 text-[13px] font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${activeTab === t.id ? 'call-detail-tab--active text-slate-900 border-slate-900' : 'text-slate-400 border-transparent hover:text-slate-600'}`}
                >
                  {t.label}
                  {t.count !== undefined && (
                    <span className={`text-[10px] rounded-md px-1.5 py-0.5 min-w-[20px] text-center ${activeTab === t.id ? 'bg-slate-100 text-slate-900' : 'bg-bg-soft text-slate-400'} border border-slate-200 ui-label`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
              {activeTab === 'details' && (
                <div className="space-y-8">
                  {reasonText && (
                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-4 flex gap-3 text-rose-800">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[12px] ui-label">Rejection remark</div>
                        <div className="text-[13px] mt-1 ui-label">{reasonText}</div>
                        {(call.crm_reject_at || call.rejected_at || call.dBMrejectdatetime) && (
                          <div className="text-[10px] text-rose-400 font-medium mt-1">
                            Rejected on {formatUiDateTime(call.crm_reject_at || call.rejected_at || call.dBMrejectdatetime)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-5">
                    <Field label="Serial no." value={call.vserialno || '—'} muted={!call.vserialno} />
                    <Field label="Client ticket" value={call.vmanualjobno || '—'} muted={!call.vmanualjobno} />
                    <Field label="Technician" value={call.engineer_name || 'Unassigned'} muted={!call.engineer_name} />
                    <Field label="Branch / Franchisee" value={call.vlocation || call.branch_name} />
                    <Field label="Reported by" value={call.vpersoncalling || 'Not recorded'} muted={!call.vpersoncalling} />
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] text-slate-400 ui-label">Complaint</div>
                    <div className="p-3.5 bg-bg-soft rounded-lg text-[13px] text-slate-500 italic border border-slate-100">
                      {call.complaint_label || 'No description provided'}
                    </div>
                  </div>

                  {isMobile && (
                    <div className="space-y-2 border-t border-slate-50 pt-6">
                      <div className="text-[11px] text-slate-400 ui-label">Lifecycle Timeline</div>
                      <div className="bg-bg-soft/50 p-4 rounded-2xl space-y-3">
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
                    call.visits.map((v, i: number) => (
                      <div key={i} className="bg-bg-canvas p-4 rounded-xl border border-slate-100 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] text-slate-900 ui-label">Visit #{i + 1}</span>
                          <span className="text-[11px] text-slate-400 ui-label">
                            {v.dvisitdatetime ? formatUiDate(v.dvisitdatetime) || 'N/A' : 'N/A'}
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
              {activeTab === 'faults' && (
                <div className="space-y-4">
                  {(call.faults || []).length > 0 ? (
                    call.faults.map((f, i: number) => (
                      <div key={i} className="bg-bg-canvas p-4 rounded-xl border border-slate-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-900 ui-label">Fault #{i + 1}</span>
                          {f.is_solved && (
                            <span className="badge-solved">
                              Solved
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-400 ui-label">Complaint</div>
                            <div className="text-[13px] text-slate-700 font-medium">{f.complaint || '—'}</div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[10px] text-slate-400 ui-label">Defect</div>
                            <div className="text-[13px] text-slate-700 font-medium">{f.defect || '—'}</div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-50">
                          <div className="text-[10px] text-slate-400 mb-1 ui-label">Work Done / Repair</div>
                          <div className="text-[13px] text-slate-900 bg-bg-soft p-3 rounded-lg border border-slate-100 ui-label">
                            {f.repair || 'No repair recorded'}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No faults recorded</div>
                  )}
                </div>
              )}

              {activeTab === 'parts' && (
                <div className="space-y-3">
                  {(call.parts || []).length > 0 ? (
                    <>
                      {replacementPartViews.length > 0 ? (
                        <PartBarcodeImages
                          views={replacementPartViews}
                          onPreview={(img) => setPreviewImage({ url: img.url, title: img.title })}
                        />
                      ) : null}

                      {regularParts.map((p, i: number) => (
                        <div key={i} className="bg-bg-canvas rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                          <div className="p-4 flex items-center justify-between border-b border-slate-50">
                            <div className="space-y-1">
                              <div className="text-[13px] text-slate-900 ui-label">{p.vpartname}</div>
                              <div className="text-[11px] text-slate-400 font-medium">{p.vpartcode}</div>
                            </div>
                            <div className="text-[16px] text-slate-900 bg-bg-soft px-3 py-1 rounded-lg ui-strong">x{p.nqty || 1}</div>
                          </div>

                          {p.vremarks ? (
                            <div className="px-4 py-3 border-t border-slate-50 text-[12px] text-slate-500 italic">
                              Note: {p.vremarks}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No parts recorded</div>
                  )}
                </div>
              )}

              {activeTab === 'images' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {allImages.map((img, i) => (
                    <ImageCard
                      key={i}
                      img={{ url: img.url, title: img.title }}
                      onPreview={() => setPreviewImage({ url: img.url, title: img.title })}
                      onLoaded={() => handleImageLoad(img.url)}
                    />
                  ))}
                </div>
              )}

              {activeTab === 'comments' && (
                <div className="space-y-4">
                  {displayComments.length > 0 ? (
                    displayComments.map((c, i: number) => (
                      <div key={i} className="flex gap-3">
                        <div className="relative w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[10px] ui-label overflow-hidden flex-shrink-0">
                          {c.author_avatar_url ? (
                            <NextImage
                              src={resolveAvatarDisplayUrl(c.author_avatar_url) ?? ''}
                              alt=""
                              fill
                              unoptimized
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            c.author_name?.charAt(0)
                          )}
                        </div>
                        <div className="flex-1 text-[13px]">
                          <div className="text-slate-900 ui-strong">{c.author_name}</div>
                          <div className="text-slate-600 mt-1">{c.comment}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">No comments recorded</div>
                  )}

                  {isMobile && (
                    <div className="mt-8 space-y-4 bg-bg-soft p-4 rounded-2xl border border-slate-100">
                      <div className="text-[11px] text-slate-400 ui-label">Quick Note</div>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Add observations..."
                        className="call-detail-textarea w-full bg-bg-canvas border border-slate-200 rounded-xl p-3 text-[13px] outline-none resize-none focus:border-slate-400"
                        rows={3}
                      />
                      <button
                        onClick={handlePostComment}
                        disabled={!note.trim()}
                        className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm disabled:opacity-30 flex items-center justify-center gap-2 ui-label"
                      >
                        <Send size={16} />
                        Post Comment
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="relative border-l border-slate-200 ml-4 pl-6 space-y-6">
                  {call.history && call.history.length > 0 ? (
                    call.history.map((h, i: number) => {
                      const { statusLabel, color, icon } = getHistoryEventMeta(h);
                      const eventDate = h.editedon || h.addedon || h.dtrndate;
                      return (
                        <div key={i} className="relative">
                          {/* Timeline dot */}
                          <span className={`absolute -left-[35px] top-1.5 flex items-center justify-center w-6 h-6 rounded-full border ${color} bg-bg-canvas shadow-sm ring-4 ring-white`}>
                            {icon}
                          </span>

                          {/* Timeline Card */}
                          <div className="bg-bg-soft border border-slate-100 rounded-xl p-4 space-y-2 hover:bg-slate-100/50 transition-colors">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
                                {statusLabel}
                              </span>
                              {eventDate && (
                                <span className="text-[10px] text-slate-400 font-medium">
                                  {formatUiDateTime(eventDate)}
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                              {h.engineer_name && (
                                <div>
                                  <span className="text-slate-400 font-medium">Engineer: </span>
                                  <span className="text-slate-700 font-semibold">{h.engineer_name}</span>
                                </div>
                              )}
                              {h.branch_name && (
                                <div>
                                  <span className="text-slate-400 font-medium">Branch: </span>
                                  <span className="text-slate-700">{h.branch_name}</span>
                                </div>
                              )}
                              {h.addedby && (
                                <div className="sm:col-span-2">
                                  <span className="text-slate-400 font-medium">Action by: </span>
                                  <span className="text-slate-700">{h.addedby}</span>
                                </div>
                              )}
                            </div>

                            {h.vcomment && h.vcomment.trim() && (
                              <div className="text-xs text-slate-500 bg-bg-canvas border border-slate-100 rounded-lg p-2.5 italic">
                                &ldquo;{h.vcomment}&rdquo;
                              </div>
                            )}

                            {h.bBMreject && h.vBMrejectreason && h.vBMrejectreason.trim() && (
                              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-2.5 font-medium">
                                Rejection Reason: {h.vBMrejectreason}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-[13px]">
                      <Clock size={36} className="text-slate-300 mb-2" />
                      No history recorded
                    </div>
                  )}
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
                <div className="text-[11px] text-slate-400 ui-label">Notes / query</div>
                <textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (errorType !== 'none') setErrorType('none');
                  }}
                  placeholder="Add observations..."
                  className="call-detail-textarea flex-1 w-full bg-bg-canvas border border-slate-200 rounded-lg p-3 text-[13px] outline-none resize-none focus:border-slate-400"
                />
                {errorType !== 'none' ? (
                  <p className="text-xs text-red-600">
                    Please explain why you are {errorType === 'hold' ? 'holding' : 'rejecting'} this
                    ticket in the notes box, then click again.
                  </p>
                ) : null}
                <button
                  onClick={handlePostComment}
                  disabled={!note.trim()}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-30 ui-label"
                >
                  Post Comment
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Footer Actions */}
      <div className="call-detail-footer-actions px-4 py-4 border-t border-slate-100 flex items-center gap-2 bg-bg-canvas pb-safe">
        <button
          onClick={() => handleStatusUpdate('noted')}
          className="call-detail-action call-detail-action--approve flex-1 py-3.5 bg-slate-900 text-white rounded-2xl text-[13px] ui-label"
        >
          Approve
        </button>
        <button
          onClick={() => setPendingAction('hold')}
          className="call-detail-action call-detail-action--hold px-6 py-3.5 bg-bg-soft text-slate-600 rounded-2xl text-[13px] border border-slate-200 ui-label"
        >
          Hold
        </button>
        <button
          onClick={() => setPendingAction('reject')}
          className="call-detail-action call-detail-action--reject px-6 py-3.5 bg-rose-50 text-rose-600 rounded-2xl text-[13px] border border-rose-100 ui-label"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ImageCard({ img, onPreview, onLoaded }: { img: { url: string; title: string }; onPreview: () => void; onLoaded: () => void }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error) return null;

  return (
    <div className="relative aspect-square cursor-pointer overflow-hidden rounded-xl border border-slate-100 bg-bg-soft" onClick={onPreview}>
      <NextImage
        src={img.url}
        alt={img.title || 'Call attachment'}
        fill
        unoptimized
        className={`w-full h-full object-cover transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => { setLoading(false); onLoaded(); }}
        onError={() => setError(true)}
      />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-bg-soft animate-pulse"><ImageIcon size={20} className="text-slate-200" /></div>}
    </div>
  );
}

function TimelineItem({ label, date, highlight, status }: { label: string; date: string; highlight?: boolean; status?: 'success' | 'danger' }) {
  const colors = {
    success: 'text-emerald-600',
    danger: 'text-rose-600',
    default: highlight ? 'text-indigo-600' : 'text-slate-900'
  };
  const dateTime = date ? formatUiDateTime(date) : '';
  const [dayPart, timePart] = dateTime.includes(' ')
    ? (dateTime.split(' ') as [string, string])
    : [dateTime, ''];

  return (
    <div className="flex justify-between items-start text-[12px] lg:text-[13px] py-0.5">
      <span className="text-slate-400 font-medium">{label}</span>
      <div className="text-right">
        <div className={`${colors[status || 'default']} leading-none ui-strong`}>
          {dayPart || '—'}
        </div>
        {timePart ? (
          <div className="text-[10px] text-slate-400 mt-0.5">{timePart}</div>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="w-full">
      <div className="text-[10px] text-slate-400 mb-1 ui-label">{label}</div>
      <div className={`text-[13px] leading-tight ${muted ? 'text-slate-300' : 'text-slate-900'} ui-label`}>
        {value}
      </div>
    </div>
  );
}
