'use client';

import React from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { TrnLink } from '@/components/calls/TrnLink';
import { LocationAuditCompareMap } from '@/features/location-audit/ui/LocationAuditCompareMap';
import { formatGpsSourceForDisplay } from '@/lib/geo/parse-latlong';
import { auditSemantics, statusSemantics } from '@/lib/ui/semantics';

export type LocationAuditDetailRow = {
  vtrnno: string;
  ncode: string;
  officeId: string;
  partyName: string;
  address: string;
  pincode: string;
  city: string;
  state: string;
  branchName: string;
  franchiseeName: string;
  technicianName?: string;
  crmLat: number | null;
  crmLng: number | null;
  gpsSource: string | null;
  storedGpsRaw?: string;
  mismatchExplanation?: string;
  status: string;
  fraudSignal?: string;
  pincodeInAddress?: string;
  storedGpsPincode?: string;
  storedGpsPincodeArea?: string;
  pincodeMatchStatus?: 'same' | 'different' | 'unknown';
  pincodeCheckNote?: string;
  gpsToInstallAreaKm?: number | null;
  severity?: string;
  expectedInstallLat?: number | null;
  expectedInstallLng?: number | null;
  installGeocodeMethod?: string;
  installGeocodeArea?: string;
  distanceToInstallM?: number | null;
  visitLat?: number | null;
  visitLng?: number | null;
  visitGpsSource?: string | null;
  visitDatetime?: string;
  distanceVisitToInstallM?: number | null;
  distanceVisitToStoredM?: number | null;
  signals?: {
    pincode: { pass: boolean; reason: string };
    distance: { pass: boolean; reason: string };
    addressPin: { pass: boolean; reason: string };
    visit: { pass: boolean; reason: string };
  };
};

function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function severityStyles(severity: string | undefined) {
  if (severity === 'flag') return auditSemantics.fail;
  if (severity === 'review') return auditSemantics.review;
  if (severity === 'incomplete') return statusSemantics.neutralBg;
  return auditSemantics.pass;
}

function SignalRow({ label, pass, reason }: { label: string; pass: boolean; reason: string }) {
  return (
    <div className="flex gap-2 text-[10px]">
      <span
        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${pass ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />
      <div>
        <span className="font-medium text-slate-800">{label}</span>
        <p className="text-slate-600">{reason}</p>
      </div>
    </div>
  );
}

export function LocationAuditRowDetail({
  row,
  loading = false,
  onClose,
  pincodeOnly = false,
}: {
  row: LocationAuditDetailRow | null;
  loading?: boolean;
  onClose?: () => void;
  pincodeOnly?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-slate-200 bg-bg-canvas p-8">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <p className="mt-3 text-[11px] text-slate-600">Loading location detail…</p>
      </div>
    );
  }

  if (!row) return null;

  const stored =
    row.crmLat != null && row.crmLng != null
      ? {
          lat: row.crmLat,
          lng: row.crmLng,
          label: 'S',
          title: 'Stored GPS (when call was completed)',
          color: '#e11d48',
        }
      : null;

  const expected =
    row.expectedInstallLat != null && row.expectedInstallLng != null
      ? {
          lat: row.expectedInstallLat,
          lng: row.expectedInstallLng,
          label: 'E',
          title: `Expected install${row.installGeocodeArea ? ` — ${row.installGeocodeArea}` : ''}`,
          color: '#059669',
        }
      : null;

  const visit =
    row.visitLat != null && row.visitLng != null
      ? {
          lat: row.visitLat,
          lng: row.visitLng,
          label: 'V',
          title: 'Latest visit GPS',
          color: '#2563eb',
        }
      : null;

  const isPincodeMismatch =
    row.pincodeMatchStatus === 'different' || row.fraudSignal === 'pincode_mismatch';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-bg-canvas shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-slate-900">
            Call{' '}
            <TrnLink
              trn={row.vtrnno}
              callId={row.ncode}
              officeId={row.officeId}
              className="text-blue-700 hover:underline"
              stopPropagation={false}
            />
          </p>
          <p className="truncate text-[11px] text-slate-700">{row.partyName}</p>
          <p className="mt-1 text-[10px] text-slate-600">
            {row.branchName}
            {row.franchiseeName ? ` · ${row.franchiseeName}` : ''}
          </p>
          {!pincodeOnly ? (
            <p
              className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${severityStyles(row.severity)}`}
            >
              {row.severity === 'flag'
                ? 'Flagged'
                : row.severity === 'review'
                  ? 'Review'
                  : row.severity === 'incomplete'
                    ? 'Incomplete data'
                    : 'OK'}
            </p>
          ) : null}
          <p
            className={`mt-1 text-[11px] font-medium ${
              isPincodeMismatch ? 'text-rose-800' : 'text-slate-700'
            }`}
          >
            {isPincodeMismatch
              ? `Pincode mismatch — install ${row.pincode || '—'} vs GPS area ${row.storedGpsPincode || '—'}`
              : row.pincodeMatchStatus === 'same'
                ? 'Pincodes match at install and stored GPS'
                : 'No pincode mismatch'}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-bg-soft"
            aria-label="Close detail"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
        {(stored || expected || visit) && (
          <LocationAuditCompareMap
            mapKey={`${row.vtrnno}-${row.ncode}-${row.expectedInstallLat}-${row.crmLat}-${row.visitLat}`}
            stored={stored}
            expected={expected}
            visit={visit}
            distanceM={row.distanceToInstallM ?? null}
          />
        )}

        {row.signals && !pincodeOnly ? (
          <div className="rounded-lg border border-slate-200 bg-bg-soft/80 p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              Location checks
            </p>
            <SignalRow label="Pincode" {...row.signals.pincode} />
            <SignalRow label="Distance to install" {...row.signals.distance} />
            <SignalRow label="Address pincode" {...row.signals.addressPin} />
            <SignalRow label="Visit GPS" {...row.signals.visit} />
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-bg-soft/80 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Pincode check
          </p>
          <dl className="grid gap-2 text-[10px]">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Install pincode</dt>
              <dd className="font-mono font-medium text-slate-800">{row.pincode || '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">At stored GPS</dt>
              <dd className="text-right font-mono font-medium text-slate-800">
                {row.storedGpsPincode || '—'}
              </dd>
            </div>
            {!pincodeOnly && row.gpsToInstallAreaKm != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">GPS → install area</dt>
                <dd className="font-mono font-medium text-slate-800">
                  ~{row.gpsToInstallAreaKm} km
                </dd>
              </div>
            ) : null}
            {!pincodeOnly && row.distanceToInstallM != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Stored → expected install</dt>
                <dd className="font-mono font-medium text-slate-800">
                  {(row.distanceToInstallM / 1000).toFixed(1)} km
                </dd>
              </div>
            ) : null}
            {!pincodeOnly && row.distanceVisitToInstallM != null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Visit → install</dt>
                <dd className="font-mono font-medium text-slate-800">
                  {(row.distanceVisitToInstallM / 1000).toFixed(1)} km
                </dd>
              </div>
            ) : null}
          </dl>
          {row.installGeocodeMethod ? (
            <p className="mt-2 text-[9px] text-slate-500">{row.installGeocodeMethod}</p>
          ) : null}
        </div>

        <p className="text-[10px] leading-relaxed text-slate-600">
          <span className="font-medium text-slate-800">Install address:</span> {row.address || '—'}
        </p>

        {row.crmLat != null && row.crmLng != null ? (
          <a
            href={googleMapsUrl(row.crmLat, row.crmLng)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 py-2 text-[10px] font-medium text-blue-800 hover:bg-blue-100"
          >
            Open stored GPS in Google Maps
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            No stored GPS coordinates on this call.
          </p>
        )}

        {row.storedGpsRaw ? (
          <p className="text-[10px] text-slate-600">
            Stored ({formatGpsSourceForDisplay(row.gpsSource)}):{' '}
            <span className="font-mono">{row.storedGpsRaw}</span>
          </p>
        ) : null}

        {row.mismatchExplanation ? (
          <p className="rounded-lg border border-slate-100 bg-bg-soft px-3 py-2 text-[10px] leading-relaxed text-slate-700">
            {row.mismatchExplanation}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function LocationAuditMapPlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-bg-soft/80 p-6 text-center">
      <MapPinIcon />
      <p className="mt-3 text-[12px] font-semibold text-slate-700">Select a call to review location</p>
      <p className="mt-1 max-w-[260px] text-[10px] text-slate-500">
        Click Refresh to load the audit, then select a row. Install, stored, and visit GPS load on
        demand.
      </p>
    </div>
  );
}

function MapPinIcon() {
  return (
    <svg
      className="h-10 w-10 text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z"
      />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
