'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ScanBarcode,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { RegisterFilterBar } from '@/components/RegisterFilterBar';
import { PageShell } from '@/components/PageShell';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminToolbar,
  AdminTr,
} from '@/components/admin/AdminUi';
import { useReportFilters } from '@/contexts/ReportFiltersContext';
import {
  aggregateComplaintsBySerial,
  filterSerialAuditRows,
  getAllCallsForAudit,
  summarizeSerialAudit,
  type SerialAuditRow,
} from '@/lib/serial-complaint-audit';

const DEFAULT_RISK_THRESHOLD = 3;

export default function SerialAuditPage() {
  const {
    search,
    pincodeSearch,
    dateRange,
    selectedOfficeIds,
    selectedCallTypes,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedStatus,
    priorityFilter,
    portalFilter,
    distributionCalls,
    distributionLoading,
    rehydrateDistributionFromCache,
    ensureSharedCallsLoaded,
    resourcesLoaded,
  } = useReportFilters();

  const [mounted, setMounted] = useState(false);
  const [serialSearch, setSerialSearch] = useState('');
  const [minCount, setMinCount] = useState(DEFAULT_RISK_THRESHOLD);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    rehydrateDistributionFromCache();
    ensureSharedCallsLoaded();
  }, [rehydrateDistributionFromCache, ensureSharedCallsLoaded]);

  const filterParts = useMemo(
    () => ({
      search,
      pincodeSearch,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedOfficeIds,
      selectedTechnician,
      selectedCallTypes,
      selectedStatus,
      priorityFilter,
      portalFilter,
    }),
    [
      search,
      pincodeSearch,
      selectedState,
      selectedCity,
      selectedBranch,
      selectedFranchisee,
      selectedOfficeIds,
      selectedTechnician,
      selectedCallTypes,
      selectedStatus,
      priorityFilter,
      portalFilter,
    ]
  );

  const auditCalls = useMemo(
    () => getAllCallsForAudit(filterParts, distributionCalls as Record<string, unknown>[]),
    [filterParts, distributionCalls]
  );

  const allSerialRows = useMemo(
    () => aggregateComplaintsBySerial(auditCalls, DEFAULT_RISK_THRESHOLD),
    [auditCalls]
  );

  const displayedRows = useMemo(
    () =>
      filterSerialAuditRows(allSerialRows, {
        minCount: onlyFlagged ? DEFAULT_RISK_THRESHOLD : minCount,
        search: serialSearch,
        onlyFlagged,
        hideUnknown: true,
      }),
    [allSerialRows, minCount, serialSearch, onlyFlagged]
  );

  const summary = useMemo(
    () => summarizeSerialAudit(allSerialRows, DEFAULT_RISK_THRESHOLD),
    [allSerialRows]
  );

  const cacheEmpty = auditCalls.length === 0;
  const hasSerialData = auditCalls.some(
    (r) => r.callsvserialno != null && String(r.callsvserialno).trim() !== ''
  );

  const toggleExpand = (serial: string) => {
    setExpandedSerial((prev) => (prev === serial ? null : serial));
  };

  if (!mounted || !resourcesLoaded) {
    return (
      <PageShell title="Serial Audit" icon={<ScanBarcode className="h-4 w-4" />}>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Serial Audit"
      subtitle="Repeat complaints by device serial"
      icon={<ScanBarcode className="h-4 w-4" />}
      actions={
        <Link
          href="/report"
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
        >
          <ExternalLink className="h-3 w-3" />
          Call Register
        </Link>
      }
      toolbar={<RegisterFilterBar />}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-slate-50 p-4"
    >
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <AdminStatPill label="Serials" value={summary.totalSerials} />
        <AdminStatPill label="Flagged (≥3)" value={summary.flaggedCount} />
        <AdminStatPill label="Max complaints" value={summary.maxComplaints} />
        <AdminStatPill label="Calls in scope" value={auditCalls.length} />
      </div>

      <AdminToolbar
        search={serialSearch}
        onSearchChange={setSerialSearch}
        searchPlaceholder="Search serial, TRN, customer..."
      >
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="text-slate-400">Min complaints</span>
          <input
            type="number"
            min={1}
            max={99}
            value={minCount}
            disabled={onlyFlagged}
            onChange={(e) => setMinCount(Math.max(1, Number(e.target.value) || 1))}
            className="w-14 rounded border border-slate-200 px-2 py-1 text-[11px]"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
            className="rounded border-slate-300"
          />
          Flagged only
        </label>
      </AdminToolbar>

      {cacheEmpty && !distributionLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-700">No call data in cache</p>
          <p className="max-w-md text-[11px] text-slate-500">
            Open MIS Reports and run Sync or Full Reload for the current date range, then return
            here.
          </p>
          <Link
            href="/report"
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
          >
            Go to MIS Reports
          </Link>
        </div>
      ) : !hasSerialData && !distributionLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-700">Serial numbers not in cache yet</p>
          <p className="max-w-md text-[11px] text-slate-500">
            Run Full Reload on Call Register so the shared cache includes serial numbers for all
            calls in range.
          </p>
        </div>
      ) : (
        <AdminTableCard
          isEmpty={displayedRows.length === 0}
          empty={
            <>
              <p className="text-sm font-medium text-slate-600">No serials match filters</p>
              <p className="text-[11px] text-slate-400">
                Lower the minimum complaint count or clear &quot;Flagged only&quot;.
              </p>
            </>
          }
        >
          <AdminTable>
            <AdminThead>
              <tr>
                <AdminTh className="w-8">
                  <span className="sr-only">Expand</span>
                </AdminTh>
                <AdminTh>Serial</AdminTh>
                <AdminTh align="right">Complaints</AdminTh>
                <AdminTh align="right">Open</AdminTh>
                <AdminTh align="right">Solved</AdminTh>
                <AdminTh align="right">Cancelled</AdminTh>
                <AdminTh>Branches</AdminTh>
                <AdminTh>Customers</AdminTh>
                <AdminTh>Last date</AdminTh>
              </tr>
            </AdminThead>
            <tbody>
              {displayedRows.map((row) => (
                <SerialAuditTableRow
                  key={row.serial}
                  row={row}
                  expanded={expandedSerial === row.serial}
                  onToggle={() => toggleExpand(row.serial)}
                  riskThreshold={DEFAULT_RISK_THRESHOLD}
                />
              ))}
            </tbody>
          </AdminTable>
        </AdminTableCard>
      )}

      {distributionLoading ? (
        <p className="flex-shrink-0 text-center text-[10px] text-slate-400">Refreshing call cache…</p>
      ) : null}
    </PageShell>
  );
}

function SerialAuditTableRow({
  row,
  expanded,
  onToggle,
  riskThreshold,
}: {
  row: SerialAuditRow;
  expanded: boolean;
  onToggle: () => void;
  riskThreshold: number;
}) {
  const flagged = row.complaintCount >= riskThreshold;
  const rowBg = flagged ? 'bg-amber-50/80 hover:bg-amber-50' : '';

  return (
    <>
      <AdminTr>
        <AdminTd className={`w-8 ${rowBg}`}>
          <button
            type="button"
            onClick={onToggle}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </AdminTd>
        <AdminTd className={`font-mono text-[11px] ${rowBg}`}>
          <span className={flagged ? 'font-semibold text-amber-900' : 'text-slate-800'}>
            {row.serial}
          </span>
          {flagged ? (
            <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-900">
              Flagged
            </span>
          ) : null}
        </AdminTd>
        <AdminTd align="right" className={`font-semibold tabular-nums ${rowBg}`}>
          {row.complaintCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-blue-700 ${rowBg}`}>
          {row.openCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-emerald-700 ${rowBg}`}>
          {row.solvedCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-rose-600 ${rowBg}`}>
          {row.cancelledCount}
        </AdminTd>
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {row.uniqueBranches.length > 0
            ? row.uniqueBranches.slice(0, 2).join(', ') +
              (row.uniqueBranches.length > 2 ? ` +${row.uniqueBranches.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {row.uniqueCustomers.length > 0
            ? row.uniqueCustomers.slice(0, 2).join(', ') +
              (row.uniqueCustomers.length > 2 ? ` +${row.uniqueCustomers.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`whitespace-nowrap text-[11px] text-slate-600 ${rowBg}`}>
          {row.lastComplaintDate
            ? row.lastComplaintDate.slice(0, 10)
            : '—'}
        </AdminTd>
      </AdminTr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50/80">
          <td colSpan={9} className="px-4 py-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Sample TRNs ({row.uniqueTrns.length} total)
            </p>
            <div className="flex flex-wrap gap-2">
              {row.sampleTrns.map((trn) => (
                <Link
                  key={trn}
                  href={`/report?search=${encodeURIComponent(trn)}`}
                  className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                >
                  {trn}
                </Link>
              ))}
              {row.uniqueTrns.length > row.sampleTrns.length ? (
                <span className="self-center text-[10px] text-slate-400">
                  +{row.uniqueTrns.length - row.sampleTrns.length} more
                </span>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
