'use client';

import React, { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <div className="tooltip-wrapper relative inline-block">
      {children}
      <div className="tooltip-content">
        {content}
        <div className="tooltip-arrow" />
      </div>
    </div>
  );
}
