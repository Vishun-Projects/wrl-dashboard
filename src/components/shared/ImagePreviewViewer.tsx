'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

type ImagePreviewViewerProps = {
  src: string;
  title?: string;
  onClose: () => void;
};

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function ImagePreviewViewer({ src, title, onClose }: ImagePreviewViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  const resetView = useCallback(() => {
    setScale(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [src, resetView]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => clampScale(Number((s + delta).toFixed(2))));
  }, []);

  const rotateBy = useCallback((degrees: number) => {
    setRotation((r) => (r + degrees) % 360);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(SCALE_STEP);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(-SCALE_STEP);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        resetView();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateBy(e.shiftKey ? -90 : 90);
        return;
      }
      const step = e.shiftKey ? 48 : 24;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPan((p) => ({ ...p, x: p.x + step }));
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPan((p) => ({ ...p, x: p.x - step }));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setPan((p) => ({ ...p, y: p.y + step }));
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setPan((p) => ({ ...p, y: p.y - step }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, resetView, rotateBy, zoomBy]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP;
    zoomBy(delta);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: dragRef.current.panX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.panY + (e.clientY - dragRef.current.startY),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  };

  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      className="absolute inset-0 z-[210] flex flex-col bg-slate-950/95 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={title ? `Image preview: ${title}` : 'Image preview'}
      onClick={onClose}
    >
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 sm:px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-white/90">
            {title || 'Attachment'}
          </p>
          <p className="text-[10px] text-white/50" aria-live="polite">
            Zoom {zoomPercent}% · Rotation {rotation}° · Drag to pan · +/- zoom · R rotate · 0 reset
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-1"
          role="toolbar"
          aria-label="Image viewer controls"
        >
          <ToolbarButton
            label="Zoom out"
            shortcut="-"
            onClick={() => zoomBy(-SCALE_STEP)}
            disabled={scale <= MIN_SCALE}
          >
            <ZoomOut size={18} aria-hidden />
          </ToolbarButton>
          <span
            className="min-w-[3rem] px-1 text-center text-[11px] font-medium tabular-nums text-white/80"
            aria-label={`Current zoom ${zoomPercent} percent`}
          >
            {zoomPercent}%
          </span>
          <ToolbarButton
            label="Zoom in"
            shortcut="+"
            onClick={() => zoomBy(SCALE_STEP)}
            disabled={scale >= MAX_SCALE}
          >
            <ZoomIn size={18} aria-hidden />
          </ToolbarButton>

          <span className="mx-1 hidden h-5 w-px bg-bg-canvas/15 sm:inline" aria-hidden />

          <ToolbarButton label="Rotate left" shortcut="Shift+R" onClick={() => rotateBy(-90)}>
            <RotateCcw size={18} aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Rotate right" shortcut="R" onClick={() => rotateBy(90)}>
            <RotateCw size={18} aria-hidden />
          </ToolbarButton>
          <ToolbarButton label="Reset view" shortcut="0" onClick={resetView}>
            <span className="text-[10px] font-semibold">Reset</span>
          </ToolbarButton>

          <span className="mx-1 hidden h-5 w-px bg-bg-canvas/15 sm:inline" aria-hidden />

          <ToolbarButton
            label="Open image in new tab"
            onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink size={18} aria-hidden />
          </ToolbarButton>
          <a
            href={src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-bg-canvas/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Download image"
            onClick={(e) => e.stopPropagation()}
          >
            <Download size={18} aria-hidden />
          </a>

          <ToolbarButton label="Close preview" shortcut="Esc" onClick={onClose}>
            <X size={18} aria-hidden />
          </ToolbarButton>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 touch-none overflow-hidden ${isDragging ? 'cursor-grabbing' : scale > 1 ? 'cursor-grab' : 'cursor-default'}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => e.stopPropagation()}
        aria-label="Image viewport. Use arrow keys to pan when zoomed."
      >
        <div className="flex h-full w-full items-center justify-center p-4 sm:p-8">
          <img
            src={src}
            alt={title || 'Call attachment preview'}
            draggable={false}
            className="max-h-full max-w-full select-none transition-transform duration-75 ease-out"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale}) rotate(${rotation}deg)`,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={shortcut ? `${label}, shortcut ${shortcut}` : label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-bg-canvas/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
