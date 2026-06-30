'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <ModalPortal open={open}>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
        <ModalBackdrop
          onClick={() => {
            if (!loading) onCancel();
          }}
        />
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby={description ? 'confirm-dialog-desc' : undefined}
          className="relative z-[1] w-full max-w-md rounded-xl border border-slate-200 bg-bg-canvas p-5 shadow-xl animate-in zoom-in-95 fade-in duration-200"
        >
        <h2 id="confirm-dialog-title" className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {description ? (
          <div id="confirm-dialog-desc" className="mt-2 text-[13px] text-slate-600">
            {description}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-bg-soft disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50',
              variant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-slate-900 hover:bg-slate-800'
            )}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
