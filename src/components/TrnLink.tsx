'use client';

import React from 'react';
import { useCallDetailDialog } from '@/components/CallDetailDialogProvider';

type TrnLinkProps = {
  trn: string;
  callId?: string;
  officeId?: string;
  className?: string;
  stopPropagation?: boolean;
  children?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function TrnLink({
  trn,
  callId,
  officeId,
  className,
  stopPropagation = true,
  children,
  onClick,
}: TrnLinkProps) {
  const { openCallDetail } = useCallDetailDialog();

  return (
    <button
      type="button"
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (stopPropagation) event.stopPropagation();
        openCallDetail({ trn, callId, officeId });
      }}
    >
      {children ?? trn}
    </button>
  );
}
