'use client';

import React, { useState } from 'react';
import { Image } from 'lucide-react';
import type { CallImage, ReplacementPartView } from '@/lib/calls/part-barcode-images';
import { repairSemantics } from '@/lib/ui/semantics';

type PartBarcodeImagesProps = {
  views: ReplacementPartView[];
  onPreview: (img: CallImage) => void;
};

export function PartBarcodeImages({ views, onPreview }: PartBarcodeImagesProps) {
  if (views.length === 0) return null;

  return (
    <div className="space-y-4">
      {views.map((view, index) => (
        <ReplacementPartCard key={index} view={view} onPreview={onPreview} />
      ))}
    </div>
  );
}

function ReplacementPartCard({
  view,
  onPreview,
}: {
  view: ReplacementPartView;
  onPreview: (img: CallImage) => void;
}) {
  const badgeClass =
    view.partKind === 'compressor'
      ? repairSemantics.compressor
      : view.partKind === 'motor'
        ? repairSemantics.motor
        : 'bg-slate-100 text-slate-700 border-slate-200';

  const kindLabel =
    view.partKind === 'compressor'
      ? 'Compressor'
      : view.partKind === 'motor'
        ? 'Motor'
        : 'Replacement';

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-3 border-b border-slate-50">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ui-label ${badgeClass}`}>
              {kindLabel}
            </span>
            <div className="text-[13px] text-slate-900 ui-label truncate">{view.part.vpartname}</div>
          </div>
          {view.part.vpartcode ? (
            <div className="text-[11px] text-slate-400 font-medium">{view.part.vpartcode}</div>
          ) : null}
        </div>
        {view.part.nqty != null ? (
          <div className="text-[16px] text-slate-900 bg-slate-50 px-3 py-1 rounded-lg ui-strong shrink-0">
            x{view.part.nqty || 1}
          </div>
        ) : null}
      </div>

      <div className="p-4 space-y-4 bg-slate-50/50">
        <BarcodeRow label="Old barcode" match={view.oldBarcode} onPreview={onPreview} />
        <BarcodeRow label="New barcode" match={view.newBarcode} onPreview={onPreview} highlight />

        {view.otherImages.length > 0 ? (
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 ui-label">Attached photos</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {view.otherImages.map((img) => (
                <Thumbnail key={img.url} img={img} onPreview={() => onPreview(img)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {view.part.vremarks ? (
        <div className="px-4 py-3 border-t border-slate-50 text-[12px] text-slate-500 italic">
          Note: {view.part.vremarks}
        </div>
      ) : null}
    </div>
  );
}

function BarcodeRow({
  label,
  match,
  onPreview,
  highlight,
}: {
  label: string;
  match: ReplacementPartView['oldBarcode'];
  onPreview: (img: CallImage) => void;
  highlight?: boolean;
}) {
  if (!match) return null;

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 ui-label">{label}</div>
      <div
        className={`text-[12px] font-mono px-2 py-1.5 rounded border ${
          highlight
            ? 'text-slate-900 bg-emerald-50 border-emerald-100'
            : 'text-slate-600 bg-white border-slate-100'
        }`}
      >
        {match.barcode}
      </div>
      {match.images.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {match.images.map((img) => (
            <Thumbnail key={img.url} img={img} onPreview={() => onPreview(img)} />
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 italic">No matching photo found in call attachments</div>
      )}
    </div>
  );
}

function Thumbnail({ img, onPreview }: { img: CallImage; onPreview: () => void }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (error) return null;

  return (
    <button
      type="button"
      onClick={onPreview}
      className="relative aspect-square overflow-hidden rounded-xl border border-slate-100 bg-white text-left"
      title={img.title || img.filename}
    >
      <img
        src={img.url}
        alt={img.title || img.filename}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setLoading(false)}
        onError={() => setError(true)}
      />
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 animate-pulse">
          <Image size={18} className="text-slate-200" />
        </div>
      ) : null}
      {img.title ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <div className="truncate text-[9px] text-white">{img.title}</div>
        </div>
      ) : null}
    </button>
  );
}
