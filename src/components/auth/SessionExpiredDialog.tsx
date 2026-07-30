'use client';

import React, { useEffect, useState } from 'react';
import { ModalBackdrop } from '@/components/ui/ModalBackdrop';
import { ModalPortal } from '@/components/ui/ModalPortal';
import {
  confirmSessionExpiredSignIn,
  isSessionExpiredDialogOpen,
  subscribeSessionExpired,
} from '@/lib/auth/session-expired-client';

export function SessionExpiredDialog() {
  const [open, setOpen] = useState(isSessionExpiredDialogOpen);
  const [loading, setLoading] = useState(false);

  useEffect(() => subscribeSessionExpired(() => setOpen(isSessionExpiredDialogOpen())), []);

  if (!open) return null;

  return (
    <ModalPortal open={open}>
      <div
        className="fixed inset-0 z-[300] flex items-center justify-center p-4"
        role="presentation"
      >
        <ModalBackdrop onClick={() => {}} />
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          aria-describedby="session-expired-desc"
          className="relative z-[1] w-full max-w-md rounded-xl border border-slate-200 bg-bg-canvas p-5 shadow-xl animate-in zoom-in-95 fade-in duration-200"
        >
          <h2 id="session-expired-title" className="text-sm font-semibold text-slate-900">
            Session expired
          </h2>
          <p id="session-expired-desc" className="mt-2 text-[13px] text-slate-600">
            Your session lasted 3 days. Sign in again to continue.
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void confirmSessionExpiredSignIn();
              }}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? 'Please wait…' : 'Sign in again'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
