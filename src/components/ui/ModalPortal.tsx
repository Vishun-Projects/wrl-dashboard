'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ModalPortalProps = {
  open: boolean;
  children: React.ReactNode;
};

/** Renders modals on `document.body` so overlays cover sidebar + main content. */
export function ModalPortal({ open, children }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;
  return createPortal(children, document.body);
}
