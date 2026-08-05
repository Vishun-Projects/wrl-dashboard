'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  SlidersHorizontal,
  RefreshCw,
  Map as LucideMap,
  Download,
} from 'lucide-react';
import axios from 'axios';
import { useDistributionSummary } from '@/modules/mis';
import {
  DistributionActiveFilters,
  type DistributionFilterChip,
} from '@/modules/distribution/components/DistributionActiveFilters';
import {
  DistributionIssueBadge,
  DistributionLoadBadge,
  DistributionTablePanel,
} from '@/modules/distribution/components/DistributionTablePanel';
import { RegisterPageFilters } from '@/modules/mis/register/components/RegisterPageFilters';
import { RegisterStatsBar } from '@/modules/mis/register/components/RegisterStatsBar';
import { PageShell } from '@/components/layout/PageShell';
import { ReportPageSkeleton, useReportFilters } from '@/modules/mis/components';
import { createClient } from '@/lib/supabase/client';
import {
  sortRows,
  toggleSort,
  type TableSortState,
} from '@/lib/ui/table-sort';
import {
  exportDistributionFranchiseeCsv,
  exportDistributionIdleCsv,
} from '@/modules/distribution/services/export-csv';
import { triggerBlobDownload } from '@/modules/mis';
import { logClientExportAction } from '@/lib/security/client-export-audit';
import { feedback } from '@/lib/ui/feedback';
import { buildCorpusViewDateFilter, filterCorpusCallsByViewDate } from '@/modules/mis';
import { loadEngineerRosterForBranch, getCachedEngineerRoster } from '@/modules/distribution/services/engineer-roster-cache';
import {
  buildAuditScopeFilterParts,
  buildIdleAssigneeKpis,
  buildIdleAssigneeRows,
  buildRosterFranchiseesFromOffices,
  idleRowFranchiseeLinkCode,
  idleRowMatchesFranchisee,
  isUnallocatedFranchiseeCode,
  normalizeOfficeCode,
  rowMatchesAuditScope,
  IDLE_ISSUE_LABELS,
  scopeRosterTechniciansToFilters,
  type IdleAssigneeIssue,
  type IdleAssigneeRow,
  type RosterTechnician,
} from '@/modules/distribution/services/idle-assignees';
import {
  appliedFilterPartsFromSnapshot,
  buildRegisterViewFiltersFromContext,
  toDateString,
} from '@/modules/mis';
import {
  distributionOpenCallClasses,
  distributionRatioLevel,
} from '@/lib/ui/semantics';
import {
  classifyRegisterRowStatus,
  deriveRegisterView,
  isRegisterRowOpenBucket,
  isRegisterRowSolvedBucket,
} from '@/modules/mis';
import type { RegisterSummary } from '@/modules/mis';

export default function CallDistributionPage() {
  const {
    dateRange,
    dateFilterColumn,
    selectedState,
    selectedCity,
    selectedBranch,
    selectedFranchisee,
    selectedTechnician,
    selectedCallTypes,
    selectedStatus,
    priorityFilter,
    portalFilter,
    debouncedPincodeSearch,
    syncCascadeOptionsFromCalls,
    resourcesLoaded,
    offices,
    appliedFilters,
    appliedRevision,
  } = useReportFilters();

  const supabase = useMemo(() => createClient(), []);
  const {
    calls: distributionCalls,
    loading: distributionLoading,
    refetch: refetchDistribution,
  } = useDistributionSummary(supabase, appliedFilters, appliedRevision);

  const mounted = typeof window !== 'undefined';

  const applied = appliedFilters;
  const startDateStr = useMemo(
    () => (applied ? toDateString(applied.dateRange.start) : toDateString(dateRange.start)),
    [applied, dateRange.start]
  );
  const endDateStr = useMemo(
    () => (applied ? toDateString(applied.dateRange.end) : toDateString(dateRange.end)),
    [applied, dateRange.end]
  );
  const appliedDateColumn = applied?.dateFilterColumn ?? dateFilterColumn;
  const viewDateFilter = useMemo(
    () => buildCorpusViewDateFilter(startDateStr, endDateStr, appliedDateColumn),
    [startDateStr, endDateStr, appliedDateColumn]
  );

  const [registerSummary, setRegisterSummary] = useState<RegisterSummary | null>(null);
  const [distributionMetrics, setDistributionMetrics] = useState({
    franchiseesCount: 0,
    activeTechniciansCount: 0,
    callToTechnicianRatio: 0,
  });
  const [franchiseeSummary, setFranchiseeSummary] = useState<FranchiseeRow[]>([]);
  const [rosterTechnicians, setRosterTechnicians] = useState<RosterTechnician[]>([]);
  const [idleRosterLoading, setIdleRosterLoading] = useState(false);
  const [idleSort, setIdleSort] = useState<TableSortState<keyof IdleAssigneeRow | 'issue'>>({
    key: 'issue',
    dir: 'asc',
  });
  const [idleIssueFilter, setIdleIssueFilter] = useState<IdleAssigneeIssue | null>(
    'assigned_no_completions'
  );
  const [highlightedIdleKey, setHighlightedIdleKey] = useState<string | null>(null);

  const [franSort, setFranSort] = useState<TableSortState>({ key: 'ratio', dir: 'desc' });
  const [highlightedFranchisee, setHighlightedFranchisee] = useState<string | null>(null);

  useEffect(() => {
    if (distributionCalls.length > 0) {
      syncCascadeOptionsFromCalls(distributionCalls);
    }
  }, [distributionCalls, selectedState, selectedCity, selectedBranch, selectedFranchisee, selectedTechnician, selectedCallTypes, selectedStatus, priorityFilter, portalFilter, debouncedPincodeSearch, syncCascadeOptionsFromCalls]);

  const distributionViewFilters = useMemo(() => {
    if (!appliedFilters) {
      return buildRegisterViewFiltersFromContext({
        pincodeSearch: '',
        selectedState: [],
        selectedCity: [],
        selectedRegion: [],
        selectedAccount: [],
        selectedBranch: [],
        selectedFranchisee: [],
        selectedTechnician: [],
        selectedCallTypes: [],
        selectedOfficeIds: [],
        selectedStatus: [],
        priorityFilter: [],
        portalFilter: [],
        repairFilter: [],
      });
    }
    return appliedFilterPartsFromSnapshot(appliedFilters);
  }, [appliedFilters]);

  useEffect(() => {
    if (distributionCalls.length === 0) {
      queueMicrotask(() => {
        setRegisterSummary(null);
        setDistributionMetrics({
          franchiseesCount: 0,
          activeTechniciansCount: 0,
          callToTechnicianRatio: 0,
        });
        setFranchiseeSummary([]);
      });
      return;
    }

    const { filteredCalls, summary } = deriveRegisterView(
      distributionCalls,
      distributionViewFilters,
      viewDateFilter
    );
    queueMicrotask(() => setRegisterSummary(summary));

    type FranchiseeAcc = {
      franchisee_code: string;
      franchisee_name: string;
      techs: Set<string | number>;
      total_calls: number;
      open_calls: number;
      closed_calls: number;
      tech_solved: number;
    };
    const franchiseeMap = new Map<string, FranchiseeAcc>();
    const activeTechsSet = new Set<string | number>();
    const activeFranchiseesSet = new Set<string>();

    filteredCalls.forEach((c: Record<string, unknown>) => {
      const bucket = classifyRegisterRowStatus(c);
      if (bucket === 'transferred') return;

      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        activeTechsSet.add(c.nengineer as string | number);
      }

      const fCode = String(c.franchisee_code || 'UNASSIGNED');
      const fName = String(c.franchisee_name || 'Unallocated');
      if (c.franchisee_code) {
        activeFranchiseesSet.add(String(c.franchisee_code));
      }

      if (!franchiseeMap.has(fCode)) {
        franchiseeMap.set(fCode, {
          franchisee_code: fCode,
          franchisee_name: fName,
          techs: new Set<string | number>(),
          total_calls: 0,
          open_calls: 0,
          closed_calls: 0,
          tech_solved: 0,
        });
      }
      const fObj = franchiseeMap.get(fCode)!;
      fObj.total_calls++;
      if (bucket === 'cancelled') {
        fObj.closed_calls++;
      } else if (isRegisterRowSolvedBucket(bucket)) {
        fObj.closed_calls++;
        if (bucket === 'techSolved') {
          fObj.tech_solved++;
        }
      } else if (isRegisterRowOpenBucket(bucket)) {
        fObj.open_calls++;
      }
      if (c.nengineer && c.nengineer !== 0 && c.nengineer !== '0') {
        fObj.techs.add(c.nengineer as string | number);
      }
    });

    const franchiseeSummary = Array.from(franchiseeMap.values()).map((f) => {
      const techCount = f.techs.size;
      const ratio = techCount > 0 ? parseFloat((f.open_calls / techCount).toFixed(2)) : f.open_calls;
      return {
        franchisee_code: f.franchisee_code,
        franchisee_name: f.franchisee_name,
        technicians_count: techCount,
        total_calls: f.total_calls,
        open_calls: f.open_calls,
        closed_calls: f.closed_calls,
        tech_solved: f.tech_solved || 0,
        ratio
      };
    });

    franchiseeSummary.sort((a, b) => b.ratio - a.ratio);

    queueMicrotask(() => {
      setDistributionMetrics({
        franchiseesCount: activeFranchiseesSet.size,
        activeTechniciansCount: activeTechsSet.size,
        callToTechnicianRatio:
          activeTechsSet.size > 0
            ? parseFloat((summary.open / activeTechsSet.size).toFixed(2))
            : summary.open,
      });
      setFranchiseeSummary(franchiseeSummary);
    });
  }, [distributionCalls, distributionViewFilters, viewDateFilter]);

  const auditScopeFilterParts = useMemo(
    () => buildAuditScopeFilterParts(distributionViewFilters),
    [distributionViewFilters]
  );

  const auditScopeCalls = useMemo(() => {
    if (distributionCalls.length === 0) return [];
    const dateFiltered = filterCorpusCallsByViewDate(distributionCalls, viewDateFilter);
    return dateFiltered.filter((row) => rowMatchesAuditScope(row, auditScopeFilterParts));
  }, [distributionCalls, viewDateFilter, auditScopeFilterParts]);

  const rosterBranchId =
    appliedFilters && appliedFilters.selectedBranch.length > 0
      ? appliedFilters.selectedBranch[0]
      : null;

  useEffect(() => {
    if (!rosterBranchId) {
      queueMicrotask(() => setRosterTechnicians([]));
      return;
    }

    const cached = getCachedEngineerRoster(rosterBranchId);
    if (cached) {
      queueMicrotask(() => setRosterTechnicians(cached));
      return;
    }

    let cancelled = false;
    queueMicrotask(() => setIdleRosterLoading(true));
    loadEngineerRosterForBranch(rosterBranchId, async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `/api/report/engineers?branchId=${encodeURIComponent(rosterBranchId)}&roster=1`;
      const res = await axios.get<RosterTechnician[]>(url, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      return (res.data || []).map((e) => ({
        ncode: String(e.ncode),
        vname: String(e.vname || e.ncode),
        nofficeid: e.nofficeid != null ? String(e.nofficeid) : undefined,
      }));
    })
      .then((roster) => {
        if (!cancelled) setRosterTechnicians(roster);
      })
      .catch(() => {
        if (!cancelled) setRosterTechnicians([]);
      })
      .finally(() => {
        if (!cancelled) setIdleRosterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rosterBranchId, supabase]);

  const scopedRosterTechnicians = useMemo(
    () =>
      scopeRosterTechniciansToFilters(
        rosterBranchId ? rosterTechnicians : [],
        selectedFranchisee
      ),
    [rosterTechnicians, rosterBranchId, selectedFranchisee]
  );

  const rosterFranchisees = useMemo(
    () =>
      buildRosterFranchiseesFromOffices(
        offices,
        appliedFilters?.selectedBranch ?? [],
        appliedFilters?.selectedFranchisee ?? []
      ),
    [offices, appliedFilters]
  );

  const idleAssigneeRows = useMemo(
    () =>
      buildIdleAssigneeRows({
        auditScopeCalls,
        rosterTechnicians: scopedRosterTechnicians,
        rosterFranchisees,
        offices,
      }).filter((row) => row.assigneeType === 'technician'),
    [auditScopeCalls, scopedRosterTechnicians, rosterFranchisees, offices]
  );

  useEffect(() => {
    queueMicrotask(() => {
      setIdleIssueFilter('assigned_no_completions');
      setHighlightedIdleKey(null);
      setHighlightedFranchisee(null);
    });
  }, [
    startDateStr,
    endDateStr,
    dateFilterColumn,
    selectedBranch,
    selectedFranchisee,
    selectedState,
    selectedCity,
  ]);

  const franchiseeColumns = useMemo(
    () => [
      { key: 'franchisee_name', label: 'Franchisee', width: '38%', sortable: true },
      { key: 'technicians_count', label: 'Techs', width: '4rem', align: 'center' as const, sortable: true },
      { key: 'total_calls', label: 'Total', width: '4rem', align: 'center' as const, sortable: true },
      { key: 'open_calls', label: 'Open', width: '4rem', align: 'center' as const, sortable: true },
      { key: 'ratio', label: 'Ratio', width: '4.5rem', align: 'center' as const, sortable: true },
      { key: 'status', label: 'Status', width: '6.5rem', align: 'center' as const, sortable: false },
    ],
    []
  );

  const idleColumns = useMemo(
    () => [
      { key: 'name', label: 'Technician', width: '32%', sortable: true },
      { key: 'branchName', label: 'Branch', width: '22%', sortable: true },
      { key: 'issue', label: 'Status', width: '7.5rem', sortable: true },
      { key: 'assignedCalls', label: 'Assigned', width: '5rem', align: 'center' as const, sortable: true },
      { key: 'totalCalls', label: 'Total', width: '4.5rem', align: 'center' as const, sortable: true },
    ],
    []
  );

  const idleTableLoading =
    idleRosterLoading && scopedRosterTechnicians.length === 0 && rosterBranchId != null;

  const idleAssigneeKpis = useMemo(
    () => buildIdleAssigneeKpis(idleAssigneeRows),
    [idleAssigneeRows]
  );

  const idleRowKey = (row: IdleAssigneeRow) =>
    `${row.assigneeType}:${row.code}:${row.issue}`;

  type FranchiseeRow = {
    franchisee_code: string;
    franchisee_name: string;
    technicians_count: number;
    total_calls: number;
    open_calls: number;
    ratio: number;
  };

  const handleSort = (field: string) => {
    setFranSort((prev) => toggleSort(prev, field, field === 'franchisee_name' ? 'asc' : 'desc'));
  };

  const displayedFranchiseeList = useMemo(() => {
    const sorted = sortRows(
      franchiseeSummary as FranchiseeRow[],
      (row) => row[franSort.key as keyof FranchiseeRow],
      franSort.dir
    );
    if (!highlightedFranchisee) return sorted;

    const linked: FranchiseeRow[] = [];
    const rest: FranchiseeRow[] = [];
    for (const fran of sorted) {
      if (
        !isUnallocatedFranchiseeCode(fran.franchisee_code) &&
        normalizeOfficeCode(fran.franchisee_code) === highlightedFranchisee
      ) {
        linked.push(fran);
      } else {
        rest.push(fran);
      }
    }
    return [...linked, ...rest];
  }, [franchiseeSummary, franSort, highlightedFranchisee]);

  const handleIdleSort = (field: keyof IdleAssigneeRow | 'issue') => {
    setIdleSort((prev) =>
      toggleSort(prev, field, field === 'name' || field === 'issue' || field === 'branchName' ? 'asc' : 'desc')
    );
  };

  const sortedIdleAssigneeRows = useMemo(() => {
    return sortRows(
      idleAssigneeRows,
      (row) => {
        if (idleSort.key === 'issue') return row.issue;
        if (idleSort.key === 'assignedCalls' || idleSort.key === 'totalCalls') {
          return row[idleSort.key];
        }
        return String(row[idleSort.key] ?? '');
      },
      idleSort.dir
    );
  }, [idleAssigneeRows, idleSort]);

  const idleRowsByIssue = useMemo(() => {
    if (!idleIssueFilter) return sortedIdleAssigneeRows;
    return sortedIdleAssigneeRows.filter((row) => row.issue === idleIssueFilter);
  }, [sortedIdleAssigneeRows, idleIssueFilter]);

  const idleRowLinkPriority = React.useCallback((row: IdleAssigneeRow): number => {
    if (highlightedIdleKey && idleRowKey(row) === highlightedIdleKey) return 0;
    if (highlightedFranchisee && idleRowMatchesFranchisee(row, highlightedFranchisee)) return 1;
    return 2;
  }, [highlightedFranchisee, highlightedIdleKey]);

  const displayedIdleAssigneeRows = useMemo(() => {
    const rows = idleRowsByIssue;
    const linkActive = highlightedFranchisee != null || highlightedIdleKey != null;
    if (!linkActive) return rows;

    return [...rows]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const pa = idleRowLinkPriority(a.row);
        const pb = idleRowLinkPriority(b.row);
        if (pa !== pb) return pa - pb;
        return a.index - b.index;
      })
      .map(({ row }) => row);
  }, [idleRowsByIssue, highlightedFranchisee, highlightedIdleKey, idleRowLinkPriority]);

  const linkedIdleCount = useMemo(() => {
    if (!highlightedFranchisee) return 0;
    return idleRowsByIssue.filter((row) =>
      idleRowMatchesFranchisee(row, highlightedFranchisee)
    ).length;
  }, [idleRowsByIssue, highlightedFranchisee]);

  const linkedFranchiseeName = useMemo(() => {
    if (!highlightedFranchisee) return null;
    const match = franchiseeSummary.find(
      (f: { franchisee_code: string; franchisee_name: string }) =>
        normalizeOfficeCode(f.franchisee_code) === highlightedFranchisee
    );
    return match?.franchisee_name ?? highlightedFranchisee;
  }, [franchiseeSummary, highlightedFranchisee]);

  const focusedIdleRow = useMemo(() => {
    if (!highlightedIdleKey) return null;
    return idleAssigneeRows.find((row) => idleRowKey(row) === highlightedIdleKey) ?? null;
  }, [highlightedIdleKey, idleAssigneeRows]);

  const tableLinkActive = highlightedFranchisee != null || highlightedIdleKey != null;

  const clearTableLink = () => {
    setHighlightedFranchisee(null);
    setHighlightedIdleKey(null);
  };

  const distributionFilterChips = useMemo((): DistributionFilterChip[] => {
    const chips: DistributionFilterChip[] = [];
    if (idleIssueFilter) {
      chips.push({
        id: 'idle-issue',
        label: 'Idle list',
        detail: IDLE_ISSUE_LABELS[idleIssueFilter],
        tone: 'amber',
        onClear: () => setIdleIssueFilter(null),
      });
    }
    if (highlightedFranchisee) {
      chips.push({
        id: 'table-franchisee',
        label: 'Linked ASP',
        detail: linkedFranchiseeName ?? highlightedFranchisee,
        tone: 'teal',
        onClear: clearTableLink,
      });
    }
    if (highlightedIdleKey && focusedIdleRow) {
      chips.push({
        id: 'table-assignee',
        label: 'Focused row',
        detail: focusedIdleRow.name,
        tone: 'violet',
        onClear: () => setHighlightedIdleKey(null),
      });
    }
    return chips;
  }, [
    idleIssueFilter,
    highlightedFranchisee,
    highlightedIdleKey,
    linkedFranchiseeName,
    focusedIdleRow,
  ]);

  const handleFranchiseeRowClick = (franchiseeCode: string) => {
    const norm = normalizeOfficeCode(franchiseeCode);
    if (!norm) return;
    setHighlightedFranchisee((prev) => (prev === norm ? null : norm));
    setHighlightedIdleKey(null);
  };

  const handleIdleRowClick = (row: IdleAssigneeRow) => {
    const key = idleRowKey(row);
    setHighlightedIdleKey((prev) => (prev === key ? null : key));
    const linkCode = idleRowFranchiseeLinkCode(row);
    if (linkCode) {
      setHighlightedFranchisee(linkCode);
    }
  };

  if (!resourcesLoaded || !mounted) {
    return (
      <PageShell
        title="Call Distribution Audit"
        icon={<LucideMap size={16} className="text-teal-600" />}
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      >
        <ReportPageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Call Distribution Audit"
      subtitle=""
      icon={<LucideMap size={16} className="text-teal-600" />}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
      toolbar={
        <RegisterPageFilters
          onClearAll={() => {
            clearTableLink();
          }}
        />
      }
      actions={
        <>
          <button
            type="button"
            disabled={
              distributionLoading ||
              (displayedFranchiseeList.length === 0 && displayedIdleAssigneeRows.length === 0)
            }
            onClick={() => {
              try {
                const stamp = new Date().toISOString().slice(0, 10);
                let rowCount = 0;
                if (displayedFranchiseeList.length > 0) {
                  const csv = exportDistributionFranchiseeCsv(displayedFranchiseeList);
                  const filename = `distribution-franchisees-${stamp}.csv`;
                  void triggerBlobDownload(
                    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                    filename
                  );
                  rowCount += displayedFranchiseeList.length;
                  logClientExportAction({
                    action: 'report.export.complete',
                    reportName: 'distribution',
                    format: 'csv',
                    filename,
                    rowCount: displayedFranchiseeList.length,
                    summary: `Exported distribution franchisees (${displayedFranchiseeList.length} rows)`,
                  });
                }
                if (displayedIdleAssigneeRows.length > 0) {
                  const csv = exportDistributionIdleCsv(displayedIdleAssigneeRows);
                  const filename = `distribution-idle-techs-${stamp}.csv`;
                  void triggerBlobDownload(
                    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                    filename
                  );
                  rowCount += displayedIdleAssigneeRows.length;
                  logClientExportAction({
                    action: 'report.export.complete',
                    reportName: 'distribution',
                    format: 'csv',
                    filename,
                    rowCount: displayedIdleAssigneeRows.length,
                    summary: `Exported distribution idle techs (${displayedIdleAssigneeRows.length} rows)`,
                  });
                }
                if (rowCount === 0) {
                  feedback.actionFailed('Nothing to export');
                  return;
                }
                feedback.actionSuccess('CSV download started');
              } catch (err) {
                console.error(err);
                logClientExportAction({
                  action: 'report.export.failure',
                  reportName: 'distribution',
                  format: 'csv',
                  summary: 'Distribution CSV export failed',
                  metadata: { message: err instanceof Error ? err.message : String(err) },
                });
                feedback.actionFailed('CSV export failed');
              }
            }}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:bg-bg-soft disabled:opacity-50 ui-label"
            title="Download franchisee and idle-technician tables as CSV"
          >
            <Download size={13} />
            CSV
          </button>
          <button
            onClick={() => void refetchDistribution()}
            disabled={distributionLoading}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-bg-canvas px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:bg-bg-soft disabled:opacity-50 ui-label"
          >
            <RefreshCw size={13} className={distributionLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-slate-800 ui-label"
          >
            <SlidersHorizontal size={13} />
            Detailed Register
          </Link>
        </>
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">

        {/* KPIs and Tables */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg-canvas">

          {/* Stat summary — MIS Register counts + distribution-specific metrics */}
          <div className="shrink-0 border-b border-slate-200 px-3 py-2">
            <RegisterStatsBar summary={registerSummary} />
          </div>
          <div className="distribution-stats-bar custom-scrollbar shrink-0">
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-teal-700">
                {distributionLoading && distributionCalls.length === 0
                  ? '…'
                  : `${distributionMetrics.franchiseesCount} / ${distributionMetrics.activeTechniciansCount}`}
              </span>
              <span className="distribution-stat-label">ASPs / Techs</span>
            </div>
            <div className="distribution-stat-item">
              <span className="distribution-stat-value text-slate-900">
                {distributionLoading && distributionCalls.length === 0
                  ? '…'
                  : `${distributionMetrics.callToTechnicianRatio}x`}
              </span>
              <span className="distribution-stat-label">Calls / tech</span>
            </div>
            <button
              type="button"
              title="Show assignees with assigned calls but no completions in period"
              className={`distribution-stat-item distribution-stat-item--warn distribution-stat-item--clickable ${
                idleIssueFilter === 'assigned_no_completions' ? 'distribution-stat-item--active' : ''
              }`}
              onClick={() =>
                setIdleIssueFilter((prev) =>
                  prev === 'assigned_no_completions' ? null : 'assigned_no_completions'
                )
              }
            >
              <span className="distribution-stat-value text-amber-700">
                {distributionLoading && distributionCalls.length === 0
                  ? '…'
                  : idleAssigneeKpis.assignedNoCompletions}
              </span>
              <span className="distribution-stat-label">Idle Technicians</span>
            </button>
            <button
              type="button"
              title="Show roster members with zero calls in period"
              className={`distribution-stat-item distribution-stat-item--muted distribution-stat-item--clickable ${
                idleIssueFilter === 'zero_allocations' ? 'distribution-stat-item--active' : ''
              }`}
              onClick={() =>
                setIdleIssueFilter((prev) =>
                  prev === 'zero_allocations' ? null : 'zero_allocations'
                )
              }
            >
              <span className="distribution-stat-value text-slate-600">
                {idleTableLoading ? '…' : idleAssigneeKpis.zeroAllocations}
              </span>
              <span className="distribution-stat-label">Zero allocations</span>
            </button>
          </div>
          {/* {!rosterBranchId && (
            <p className="distribution-idle-hint border-b border-slate-200 bg-bg-soft/90 px-4 py-1.5 text-[10px] text-slate-500">
              Select a branch to list roster members with zero allocations (one roster load per branch, cached).
            </p>
          )} */}

          <DistributionActiveFilters
            chips={distributionFilterChips}
            tableLinkActive={tableLinkActive}
            onClearTableLink={clearTableLink}
          />
          {highlightedFranchisee && linkedIdleCount === 0 && !distributionLoading ? (
            <p className="ui-help shrink-0 border-b border-amber-100 bg-amber-50/80 px-4 py-1.5 text-amber-900">
              Linked ASP has no rows in the idle list for &quot;{idleIssueFilter ? IDLE_ISSUE_LABELS[idleIssueFilter] : 'all statuses'}&quot; — try clearing the idle status pill or pick another ASP.
            </p>
          ) : null}

          {/* Capacity + idle assignees — side by side */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 md:p-4">
            <div className="distribution-tables-split min-h-0 flex-1">
              <DistributionTablePanel
                title="Franchisee capacity"
                subtitle=""
                count={franchiseeSummary.length}
                countNote={
                  highlightedFranchisee
                    ? `· linked`
                    : undefined
                }
                loading={distributionLoading}
                loadingMessage="Analyzing capacity…"
                emptyMessage="No franchisee backlog for current filters."
                isEmpty={!distributionLoading && franchiseeSummary.length === 0}
                sortField={franSort.key}
                sortAsc={franSort.dir === 'asc'}
                onSort={handleSort}
                columns={franchiseeColumns}
                footerHint=""
              >
                {displayedFranchiseeList.map((fran, rowIndex) => {
                  const isUnallocated = isUnallocatedFranchiseeCode(fran.franchisee_code);
                  const franCode = normalizeOfficeCode(fran.franchisee_code);
                  const isLinked =
                    !isUnallocated &&
                    highlightedFranchisee != null &&
                    franCode === highlightedFranchisee;
                  const prev = displayedFranchiseeList[rowIndex - 1];
                  const showSectionBelow =
                    highlightedFranchisee != null &&
                    !isLinked &&
                    prev != null &&
                    !isUnallocatedFranchiseeCode(prev.franchisee_code) &&
                    normalizeOfficeCode(prev.franchisee_code) === highlightedFranchisee;
                  const ratioLevel = distributionRatioLevel(fran.ratio);
                  const ratioColor = distributionOpenCallClasses(ratioLevel);
                  return (
                    <tr
                      key={fran.franchisee_code}
                      title={`${fran.franchisee_name} · ${fran.open_calls} open calls`}
                      onClick={
                        isUnallocated
                          ? undefined
                          : () => handleFranchiseeRowClick(fran.franchisee_code)
                      }
                      className={`${
                        isUnallocated
                          ? 'distribution-data-table__row--unallocated'
                          : 'distribution-data-table__row--clickable'
                      } ${isLinked ? 'distribution-data-table__row--active' : ''}${
                        showSectionBelow ? ' distribution-data-table__row--below-linked' : ''
                      }`}
                    >
                      <td className="max-w-[11rem] truncate font-bold text-slate-800">
                        {fran.franchisee_name}
                      </td>
                      <td className="text-center font-semibold text-slate-600 tabular-nums">
                        {fran.technicians_count}
                      </td>
                      <td className="text-center text-slate-600 tabular-nums">{fran.total_calls}</td>
                      <td className="text-center font-bold text-amber-600 tabular-nums">{fran.open_calls}</td>
                      <td className={`text-center font-extrabold tabular-nums ${ratioColor}`}>{fran.ratio}x</td>
                      <td className="text-center">
                        <DistributionLoadBadge ratio={fran.ratio} />
                      </td>
                    </tr>
                  );
                })}
              </DistributionTablePanel>

              <DistributionTablePanel
                panelClassName="distribution-table-panel--idle"
                title="Assigned technicians with zero activity in selected period"
                subtitle=""
                count={displayedIdleAssigneeRows.length}
                countNote={
                  highlightedFranchisee && linkedIdleCount > 0
                    ? `· ${linkedIdleCount} linked`
                    : highlightedFranchisee
                      ? '· 0 linked'
                      : undefined
                }
                loading={idleTableLoading}
                loadingMessage="Loading branch technician roster…"
                emptyMessage={
                  idleIssueFilter === 'assigned_no_completions'
                    ? 'No assignees with assigned-only backlog in this scope.'
                    : 'No idle assignees for this scope.'
                }
                isEmpty={!idleTableLoading && displayedIdleAssigneeRows.length === 0}
                sortField={idleSort.key}
                sortAsc={idleSort.dir === 'asc'}
                onSort={(field) => handleIdleSort(field as keyof IdleAssigneeRow | 'issue')}
                columns={idleColumns}
                tableMinWidth="36rem"
                footerHint=""
              >
                {displayedIdleAssigneeRows.map((row, rowIndex) => {
                  const rowKey = idleRowKey(row);
                  const isFocused = highlightedIdleKey === rowKey;
                  const matchesAsp =
                    highlightedFranchisee != null &&
                    idleRowMatchesFranchisee(row, highlightedFranchisee);
                  const isLinked = isFocused || matchesAsp;
                  const priority = idleRowLinkPriority(row);
                  const prevPriority =
                    rowIndex > 0
                      ? idleRowLinkPriority(displayedIdleAssigneeRows[rowIndex - 1])
                      : -1;
                  const showSectionBelow =
                    (highlightedFranchisee != null || highlightedIdleKey != null) &&
                    prevPriority < 2 &&
                    priority === 2;
                  return (
                  <tr
                    key={rowKey}
                    title={`${row.name} · ${row.issue === 'assigned_no_completions' ? 'Assigned, no work' : 'Zero allocations'}${row.franchiseeName ? ` · ASP: ${row.franchiseeName}` : ''}`}
                    onClick={() => handleIdleRowClick(row)}
                    className={`distribution-data-table__row--clickable ${
                      isLinked ? 'distribution-data-table__row--active ' : ''
                    }${showSectionBelow ? ' distribution-data-table__row--below-linked' : ''}${
                      row.issue === 'assigned_no_completions'
                        ? 'distribution-data-table__row--idle-warn'
                        : 'distribution-data-table__row--idle-muted'
                    }`}
                  >
                    <td className="distribution-data-table__cell-name">
                      <span className="block truncate font-bold text-slate-800" title={row.name}>
                        {row.name}
                      </span>
                      {row.franchiseeName ? (
                        <span
                          className="block truncate ui-micro text-slate-500"
                          title={`ASP: ${row.franchiseeName}`}
                        >
                          ASP: {row.franchiseeName}
                        </span>
                      ) : null}
                    </td>
                    <td className="truncate text-slate-700" title={row.branchName || 'Branch unknown'}>
                      {row.branchName || '—'}
                    </td>
                    <td>
                      <DistributionIssueBadge issue={row.issue} />
                    </td>
                    <td className="text-center font-bold tabular-nums text-amber-600">{row.assignedCalls}</td>
                    <td className="text-center tabular-nums text-slate-600">{row.totalCalls}</td>
                  </tr>
                  );
                })}
              </DistributionTablePanel>
            </div>
          </div>

        </div>

      </div>
    </PageShell>
  );
}
