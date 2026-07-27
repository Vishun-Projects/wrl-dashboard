'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import {
  ScanBarcode,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Download,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { RegisterPageFilters } from '@/features/register/ui/RegisterPageFilters';
import { RegisterMultiSelect } from '@/features/register/ui/RegisterMultiSelect';
import { ReportLoadingPanel } from '@/features/report/ui/ReportLoadingFeedback';
import { formatUiDate } from '@/lib/dates/ui-date';
import { DataTableLoading } from '@/components/ui/DataTableLoading';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
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
import { useReportFilters } from '@/features/report/ui/ReportFiltersContext';
import { buildCorpusCacheKey } from '@/features/report';
import { sanitizeUserFacingMessage, toUserFacingError } from '@/lib/utils/user-facing-errors';
import {
  appliedFilterPartsFromSnapshot,
  buildSerialAuditApiScopeParams,
  buildSerialAuditDetailScopeParams,
  toDateString,
  type RegisterDeepLinkParams,
} from '@/features/report';
import { callCorpusStore } from '@/features/report';
import { MAX_CLIENT_CORPUS_DAYS } from '@/lib/trhcalls/query';
import { exportSerialAuditCsv } from '@/features/serial-audit/lib/export-csv';
import { triggerBlobDownload } from '@/features/report';
import { feedback } from '@/lib/ui/feedback';
import {
  defaultSerialAuditRepairFilterValues,
  mergeRepairCountsIntoRows,
  REPAIR_CHIP_COLLAPSE_AT,
  repairLabelForValue,
  repairMasterToPicker,
  serializeRepairFilterParam,
  type RepairMasterItem,
  type RepairPickerItem,
  type SerialAuditRepairCounts,
} from '@/features/serial-audit/lib/repair-options';
import {
  aggregateComplaintsBySerial,
  buildCallsBySerialMap,
  buildInvolvementPairKey,
  computeRepeatInvolvementAnalysis,
  countRepairsFromCallRows,
  getSerialAuditDisplayCalls,
  type RepeatInvolvementEntry,
  deriveSerialAuditRowsForView,
  resolveSerialAuditWindowCalls,
  serialAuditCallsLoadedForKey,
  serialAuditMetaFromCalls,
  serialAuditRowHasCallsInWindow,
  summarizeSerialAuditCalls,
  filterSerialAuditRows,
  getWindowCallsForSerialAudit,
  mapApiListItemToSerialAuditRow,
  mapRowToSerialAuditCallDetail,
  MIN_REPEAT_COMPLAINTS,
  normalizeSerial,
  serialRowMatchKey,
  sortSerialAuditCallDetails,
  summarizeSerialAudit,
  type SerialAuditCallDetail,
  type SerialAuditRow,
} from '@/features/serial-audit/lib/complaint-audit';
import type { ExtraActiveFilterChip } from '@/features/report';
import { MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS } from '@/features/serial-audit/lib/constants';
import { SerialAuditCallsDetailTable } from '@/features/serial-audit/ui/SerialAuditCallsDetailTable';
import { SerialAuditAnalysisPanel } from '@/features/serial-audit/ui/SerialAuditAnalysisPanel';
import { SerialRepairLegend } from '@/features/serial-audit/ui/SerialRepairLegend';
import { repairSemantics } from '@/lib/ui/semantics';
import { sortRows, toggleSort, type TableSortState } from '@/lib/ui/table-sort';

const DEFAULT_RISK_THRESHOLD = 3;
const SERIAL_PAGE_SIZE = 25;

type SerialAuditSortKey =
  | 'serial'
  | 'complaints'
  | 'open'
  | 'solved'
  | 'cancelled'
  | 'branches'
  | 'customers'
  | 'lastDate';

function serialAuditSortValue(row: SerialAuditRow, key: SerialAuditSortKey): unknown {
  switch (key) {
    case 'serial':
      return row.serial;
    case 'complaints':
      return row.complaintCount;
    case 'open':
      return row.openCount;
    case 'solved':
      return row.solvedCount;
    case 'cancelled':
      return row.cancelledCount;
    case 'branches':
      return row.uniqueBranches.join(', ');
    case 'customers':
      return row.uniqueCustomers.join(', ');
    case 'lastDate':
      return row.lastComplaintDate ?? '';
    default:
      return '';
  }
}

/** Survives tab navigation — in-flight loads keep running in the background. */
const serialAuditBackgroundCache = new Map<
  string,
  {
    rows: SerialAuditRow[];
    windowCalls: Map<string, SerialAuditCallDetail[]>;
    analysisCalls: Map<string, SerialAuditCallDetail[]>;
  }
>();
const serialAuditBackgroundInflight = new Map<string, Promise<void>>();
const serialAuditAnalysisInflight = new Map<string, Promise<void>>();

function dateRangeSpanDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}


export default function SerialAuditPage() {
  const {
    appliedFilters,
    getAppliedFiltersSnapshot,
    resourcesLoaded,
    ensureCorpusLoaded,
    prefsReady,
    appliedRevision,
  } = useReportFilters();

  const startDateStr = useMemo(
    () =>
      appliedFilters
        ? toDateString(appliedFilters.dateRange.start)
        : '',
    [appliedFilters]
  );
  const endDateStr = useMemo(
    () =>
      appliedFilters ? toDateString(appliedFilters.dateRange.end) : '',
    [appliedFilters]
  );
  const callTypeParam = useMemo(
    () =>
      !appliedFilters || appliedFilters.selectedCallTypes.length === 0
        ? 'All'
        : appliedFilters.selectedCallTypes.join(','),
    [appliedFilters]
  );

  const [draftRepairs, setDraftRepairs] = useState<string[]>([]);
  const [appliedRepairs, setAppliedRepairs] = useState<string[]>([]);
  const [repairMaster, setRepairMaster] = useState<RepairMasterItem[]>([]);
  const [repairOptionsLoading, setRepairOptionsLoading] = useState(false);

  const repairPickerItems = useMemo(
    () => repairMasterToPicker(repairMaster),
    [repairMaster]
  );
  const repairOptions = useMemo(
    () => repairPickerItems.map((item) => ({ value: item.value, label: item.vname })),
    [repairPickerItems]
  );
  const repairLabelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of repairPickerItems) map.set(item.value, item.vname);
    return map;
  }, [repairPickerItems]);

  const filterParts = useMemo(
    () =>
      appliedFilters
        ? appliedFilterPartsFromSnapshot(appliedFilters)
        : {
            search: '',
            pincodeSearch: '',
            selectedState: [],
            selectedCity: [],
            selectedBranch: [],
            selectedFranchisee: [],
            selectedTechnician: [],
            selectedCallTypes: [],
            selectedOfficeIds: [],
            selectedStatus: [],
            priorityFilter: [],
            portalFilter: [],
            repairFilter: [],
          },
    [appliedFilters]
  );

  const dateFilterColumn = appliedFilters?.dateFilterColumn ?? 'dtrndate';

  const dateRangeLabel = useMemo(
    () => `${startDateStr} → ${endDateStr}`,
    [startDateStr, endDateStr]
  );

  const registerLinkContext = useMemo((): Omit<RegisterDeepLinkParams, 'search'> | undefined => {
    if (!startDateStr || !endDateStr) return undefined;
    return {
      startDate: startDateStr,
      endDate: endDateStr,
      dateFilterColumn,
      dateRangeLabel: appliedFilters?.dateRange.label,
    };
  }, [appliedFilters?.dateRange.label, dateFilterColumn, endDateStr, startDateStr]);

  const corpusWindowKey = useMemo(
    () => buildCorpusCacheKey(startDateStr, endDateStr, dateFilterColumn),
    [startDateStr, endDateStr, dateFilterColumn]
  );

  const dataKey = useMemo(
    () => JSON.stringify({ corpusWindowKey, filterParts, appliedRepairs }),
    [corpusWindowKey, filterParts, appliedRepairs]
  );

  const supabase = createClient();
  const [mounted, setMounted] = useState(false);
  const [serialSearch, setSerialSearch] = useState('');
  const [minCount, setMinCount] = useState(MIN_REPEAT_COMPLAINTS);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null);
  const [listRows, setListRows] = useState<SerialAuditRow[]>([]);
  const [windowCallsBySerial, setWindowCallsBySerial] = useState<Map<string, SerialAuditCallDetail[]>>(
    new Map()
  );
  const [allTimeCallsBySerial, setAllTimeCallsBySerial] = useState<
    Map<string, SerialAuditCallDetail[]>
  >(new Map());
  const [showAllTimeFor, setShowAllTimeFor] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [analysisCallsBySerial, setAnalysisCallsBySerial] = useState<
    Map<string, SerialAuditCallDetail[]>
  >(new Map());
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAspBreakdown, setShowAspBreakdown] = useState(false);
  const [selectedInvolvementPair, setSelectedInvolvementPair] =
    useState<RepeatInvolvementEntry | null>(null);
  const [sort, setSort] = useState<TableSortState<SerialAuditSortKey> | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const loadGenerationRef = useRef(0);
  const lastPaintedKeyRef = useRef<string | null>(null);
  const pagePrefetchInflightRef = useRef<string | null>(null);
  const windowCallsRef = useRef(windowCallsBySerial);
  windowCallsRef.current = windowCallsBySerial;
  const defaultRepairsAppliedRef = useRef(false);
  const involvementTriggeredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadRepairMaster = useCallback(async () => {
    setRepairOptionsLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await axios.get('/api/report/serial-audit/repairs', {
        headers,
        timeout: 60000,
      });
      const items = (res.data?.repairs || []) as RepairPickerItem[];
      setRepairMaster(items.map((i) => ({ ncode: i.value, vname: i.vname })));
    } catch (err: unknown) {
      const message = sanitizeUserFacingMessage(
        axios.isAxiosError(err) && err.response?.data?.error
          ? String(err.response.data.error)
          : err instanceof Error
            ? err.message
            : 'Failed to load repair types'
      );
      feedback.actionFailed(message);
    } finally {
      setRepairOptionsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!mounted || !resourcesLoaded) return;
    void loadRepairMaster();
  }, [mounted, resourcesLoaded, loadRepairMaster]);

  const fetchRepairCountsBySerial = useCallback(
    async (
      snap: NonNullable<ReturnType<typeof getAppliedFiltersSnapshot>>,
      callType: string,
      repairs: string[]
    ): Promise<Map<string, SerialAuditRepairCounts>> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const scopeParams = buildSerialAuditApiScopeParams({
        startDate: toDateString(snap.dateRange.start),
        endDate: toDateString(snap.dateRange.end),
        callType,
        repair: serializeRepairFilterParam(repairs),
        selectedBranch: snap.selectedBranch,
        selectedFranchisee: snap.selectedFranchisee,
      });
      const res = await axios.get('/api/report/serial-audit/repair-counts', {
        headers,
        timeout: 120000,
        params: scopeParams,
      });
      const bySerial = (res.data?.bySerial || {}) as Record<string, SerialAuditRepairCounts>;
      const map = new Map<string, SerialAuditRepairCounts>();
      for (const [serial, counts] of Object.entries(bySerial)) {
        map.set(serial.trim().toUpperCase(), counts);
      }
      return map;
    },
    [getAppliedFiltersSnapshot, supabase]
  );

  const fetchCallIdsWithRepair = useCallback(
    async (repairNcodes: string[], start: string, end: string): Promise<Set<string>> => {
      if (!repairNcodes.length) return new Set();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await axios.get('/api/report/serial-audit/repair-call-ids', {
        headers,
        timeout: 120000,
        params: {
          repair: serializeRepairFilterParam(repairNcodes),
          startDate: start,
          endDate: end,
        },
      });
      const ids = (res.data?.callIds || []) as string[];
      return new Set(ids);
    },
    [supabase]
  );

  const applyCachedSnapshot = useCallback(
    (cached: {
      rows: SerialAuditRow[];
      windowCalls: Map<string, SerialAuditCallDetail[]>;
      analysisCalls: Map<string, SerialAuditCallDetail[]>;
    }) => {
      setListRows(cached.rows);
      setWindowCallsBySerial(cached.windowCalls);
      setAnalysisCallsBySerial(cached.analysisCalls);
      setLoadError(null);
      lastPaintedKeyRef.current = dataKey;
    },
    [dataKey]
  );

  const loadInvolvementAnalysis = useCallback(
    async (
      rows: SerialAuditRow[],
      scope: {
        dataKey: string;
        startDate: string;
        endDate: string;
        callType: string;
        repair: string;
        branch: string;
        franchisee: string;
      }
    ) => {
      const flaggedSerials = rows
        .filter((row) => row.riskFlag && !row.isUnknownSerial)
        .sort((a, b) => b.complaintCount - a.complaintCount)
        .slice(0, MAX_SERIAL_AUDIT_INVOLVEMENT_SERIALS)
        .map((row) => row.serial);
      if (flaggedSerials.length === 0) {
        setAnalysisCallsBySerial(new Map());
        return;
      }

      const inflightKey = `${scope.dataKey}:involvement`;
      const cached = serialAuditBackgroundCache.get(scope.dataKey);
      if (cached && cached.analysisCalls.size > 0) {
        setAnalysisCallsBySerial(cached.analysisCalls);
        return;
      }

      const existing = serialAuditAnalysisInflight.get(inflightKey);
      if (existing) {
        await existing;
        return;
      }

      const run = (async () => {
        setAnalysisLoading(true);
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers = session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {};
          const res = await axios.post(
            '/api/report/serial-audit/involvement',
            {
              serials: flaggedSerials,
              startDate: scope.startDate,
              endDate: scope.endDate,
              callType: scope.callType,
              repair: scope.repair,
              branch: scope.branch,
              franchisee: scope.franchisee,
            },
            { headers, timeout: 300000 }
          );
          const analysisCalls = buildCallsBySerialMap(
            ((res.data?.calls || []) as Record<string, unknown>[]) ?? []
          );
          for (const serial of flaggedSerials) {
            const norm = normalizeSerial(serial) ?? serial.trim().toUpperCase();
            if (!analysisCalls.has(norm)) {
              analysisCalls.set(norm, []);
            }
          }
          setAnalysisCallsBySerial(analysisCalls);
          const snapshot = serialAuditBackgroundCache.get(scope.dataKey);
          if (snapshot) {
            serialAuditBackgroundCache.set(scope.dataKey, {
              ...snapshot,
              analysisCalls,
            });
          }
        } catch (err: unknown) {
          const message = toUserFacingError(
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err
          );
          feedback.actionFailed(message || 'Could not load ASP breakdown');
        } finally {
          setAnalysisLoading(false);
        }
      })();

      serialAuditAnalysisInflight.set(inflightKey, run);
      try {
        await run;
      } finally {
        serialAuditAnalysisInflight.delete(inflightKey);
      }
    },
    [supabase]
  );

  const loadWindowData = useCallback(
    async (opts?: { force?: boolean; refresh?: boolean; repairs?: string[] }) => {
      const snap = getAppliedFiltersSnapshot();
      if (!snap) return;

      const loadStartDateStr = toDateString(snap.dateRange.start);
      const loadEndDateStr = toDateString(snap.dateRange.end);
      const loadDateFilterColumn = snap.dateFilterColumn;
      const loadCorpusWindowKey = buildCorpusCacheKey(
        loadStartDateStr,
        loadEndDateStr,
        loadDateFilterColumn
      );
      const loadFilterParts = appliedFilterPartsFromSnapshot(snap);
      const loadRepairs = opts?.repairs ?? appliedRepairs;
      const loadDataKey = JSON.stringify({
        corpusWindowKey: loadCorpusWindowKey,
        filterParts: loadFilterParts,
        appliedRepairs: loadRepairs,
      });
      const loadCallTypeParam =
        snap.selectedCallTypes.length === 0 ? 'All' : snap.selectedCallTypes.join(',');
      const loadRepairParam = serializeRepairFilterParam(loadRepairs);
      const apiScopeParams = buildSerialAuditApiScopeParams({
        startDate: loadStartDateStr,
        endDate: loadEndDateStr,
        callType: loadCallTypeParam,
        repair: loadRepairParam,
        selectedBranch: snap.selectedBranch,
        selectedFranchisee: snap.selectedFranchisee,
        minRepeats: MIN_REPEAT_COMPLAINTS,
        refresh: !!opts?.refresh,
      });
      const involvementScope = {
        startDate: loadStartDateStr,
        endDate: loadEndDateStr,
        callType: loadCallTypeParam,
        repair: loadRepairParam,
        branch: apiScopeParams.branch ?? '',
        franchisee: apiScopeParams.franchisee ?? '',
      };

      const maybePrefetchInvolvement = (rows: SerialAuditRow[], cachedAnalysis: Map<string, SerialAuditCallDetail[]>) => {
        if (!showAspBreakdown) return;
        if (
          cachedAnalysis.size === 0 &&
          rows.some((r) => r.riskFlag && !r.isUnknownSerial)
        ) {
          void loadInvolvementAnalysis(rows, {
            dataKey: loadDataKey,
            ...involvementScope,
          });
        }
      };

      const existingInflight = serialAuditBackgroundInflight.get(loadDataKey);
      if (existingInflight && !opts?.force && !opts?.refresh) {
        await existingInflight;
        const cached = serialAuditBackgroundCache.get(loadDataKey);
        if (cached) {
          applyCachedSnapshot(cached);
          lastPaintedKeyRef.current = loadDataKey;
          maybePrefetchInvolvement(cached.rows, cached.analysisCalls);
        }
        return;
      }

      if (!opts?.refresh && !opts?.force && lastPaintedKeyRef.current === loadDataKey) {
        const cached = serialAuditBackgroundCache.get(loadDataKey);
        if (cached) {
          applyCachedSnapshot(cached);
          lastPaintedKeyRef.current = loadDataKey;
          maybePrefetchInvolvement(cached.rows, cached.analysisCalls);
          return;
        }
      }

      const run = (async () => {
        const generation = loadGenerationRef.current + 1;
        loadGenerationRef.current = generation;
        const isStale = () => generation !== loadGenerationRef.current;

        if (opts?.refresh) {
          lastPaintedKeyRef.current = null;
          serialAuditBackgroundCache.delete(loadDataKey);
        }

        setLoadError(null);
        setExpandedSerial(null);
        setAllTimeCallsBySerial(new Map());
        setShowAllTimeFor(new Set());
        setLoading(true);

        try {
          const spanDays = dateRangeSpanDays(snap.dateRange.start, snap.dateRange.end);
          const corpusReady =
            spanDays <= MAX_CLIENT_CORPUS_DAYS &&
            callCorpusStore?.cacheKey === loadCorpusWindowKey &&
            (callCorpusStore?.calls.size ?? 0) > 0;

          const {
            data: { session },
          } = await supabase.auth.getSession();
          const headers = session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {};

          if (corpusReady) {
            const callIdsWithRepair =
              loadRepairs.length > 0
                ? await fetchCallIdsWithRepair(
                    loadRepairs,
                    loadStartDateStr,
                    loadEndDateStr
                  )
                : null;
            const calls = getWindowCallsForSerialAudit(
              loadFilterParts,
              loadCorpusWindowKey,
              callIdsWithRepair
            );
            let rows = aggregateComplaintsBySerial(
              calls,
              DEFAULT_RISK_THRESHOLD,
              MIN_REPEAT_COMPLAINTS
            );
            const repairCountMap = await fetchRepairCountsBySerial(
              snap,
              loadCallTypeParam,
              loadRepairs
            );
            rows = mergeRepairCountsIntoRows(rows, repairCountMap);
            const windowCalls = buildCallsBySerialMap(calls);
            setListRows(rows);
            setWindowCallsBySerial(windowCalls);
            setLoadError(null);
            lastPaintedKeyRef.current = loadDataKey;
            serialAuditBackgroundCache.set(loadDataKey, {
              rows,
              windowCalls,
              analysisCalls: new Map(),
            });
            return;
          }

          void ensureCorpusLoaded({ silent: true });

          const res = await axios.get('/api/report/serial-audit', {
            headers,
            timeout: 300000,
            params: apiScopeParams,
          });

          const apiRows = ((res.data?.serials || []) as Record<string, unknown>[])
            .filter((item) => Number(item.complaint_count) > 0)
            .map((item) =>
              mapApiListItemToSerialAuditRow(
                item as Parameters<typeof mapApiListItemToSerialAuditRow>[0],
                DEFAULT_RISK_THRESHOLD
              )
            );
          apiRows.sort((a, b) => {
            const dateCmp = (b.lastComplaintDate ?? '').localeCompare(a.lastComplaintDate ?? '');
            if (dateCmp !== 0) return dateCmp;
            return b.complaintCount - a.complaintCount;
          });

          const emptyWindowCalls = new Map<string, SerialAuditCallDetail[]>();
          setListRows(apiRows);
          setWindowCallsBySerial(emptyWindowCalls);
          setAnalysisCallsBySerial(new Map());
          lastPaintedKeyRef.current = loadDataKey;
          serialAuditBackgroundCache.set(loadDataKey, {
            rows: apiRows,
            windowCalls: emptyWindowCalls,
            analysisCalls: new Map(),
          });
          maybePrefetchInvolvement(apiRows, new Map());
        } catch (err: unknown) {
          if (isStale()) return;
          const message = toUserFacingError(
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err
          );
          setLoadError(message);
        } finally {
          if (!isStale()) setLoading(false);
        }
      })();

      serialAuditBackgroundInflight.set(loadDataKey, run);
      loadInFlightRef.current = run;
      try {
        await run;
      } finally {
        serialAuditBackgroundInflight.delete(loadDataKey);
        if (loadInFlightRef.current === run) {
          loadInFlightRef.current = null;
        }
      }
    },
    [
      appliedRepairs,
      applyCachedSnapshot,
      ensureCorpusLoaded,
      fetchCallIdsWithRepair,
      fetchRepairCountsBySerial,
      getAppliedFiltersSnapshot,
      loadInvolvementAnalysis,
      showAspBreakdown,
      supabase,
    ]
  );

  useEffect(() => {
    if (!showAspBreakdown) {
      involvementTriggeredKeyRef.current = null;
      setAnalysisCallsBySerial(new Map());
      setSelectedInvolvementPair(null);
      setAnalysisLoading(false);
      return;
    }
    if (loading || listRows.length === 0 || !lastPaintedKeyRef.current) return;
    if (involvementTriggeredKeyRef.current === dataKey) return;

    const cached = serialAuditBackgroundCache.get(dataKey);
    if (cached?.analysisCalls.size) {
      involvementTriggeredKeyRef.current = dataKey;
      setAnalysisCallsBySerial(cached.analysisCalls);
      return;
    }
    if (!listRows.some((r) => r.riskFlag && !r.isUnknownSerial)) return;

    involvementTriggeredKeyRef.current = dataKey;
    const snap = getAppliedFiltersSnapshot();
    if (!snap) return;
    const apiScopeParams = buildSerialAuditApiScopeParams({
      startDate: startDateStr,
      endDate: endDateStr,
      callType: callTypeParam,
      repair: serializeRepairFilterParam(appliedRepairs),
      selectedBranch: snap.selectedBranch,
      selectedFranchisee: snap.selectedFranchisee,
      minRepeats: MIN_REPEAT_COMPLAINTS,
    });
    void loadInvolvementAnalysis(listRows, {
      dataKey,
      startDate: startDateStr,
      endDate: endDateStr,
      callType: callTypeParam,
      repair: serializeRepairFilterParam(appliedRepairs),
      branch: apiScopeParams.branch ?? '',
      franchisee: apiScopeParams.franchisee ?? '',
    });
  }, [
    appliedRepairs,
    callTypeParam,
    dataKey,
    endDateStr,
    getAppliedFiltersSnapshot,
    listRows,
    loadInvolvementAnalysis,
    loading,
    showAspBreakdown,
    startDateStr,
  ]);

  useEffect(() => {
    if (!resourcesLoaded || !appliedFilters || !prefsReady) return;
    if (repairPickerItems.length === 0) return;
    if (defaultRepairsAppliedRef.current) return;
    defaultRepairsAppliedRef.current = true;

    const defaults = defaultSerialAuditRepairFilterValues(repairPickerItems);
    setDraftRepairs(defaults);
    setAppliedRepairs(defaults);
    void loadWindowData({ force: true, repairs: defaults });
  }, [
    appliedFilters,
    loadWindowData,
    prefsReady,
    repairPickerItems,
    resourcesLoaded,
  ]);

  const loadSerialDetails = useCallback(
    async (serial: string, scope: 'window' | 'allTime', opts?: { force?: boolean }) => {
      const serialNorm = normalizeSerial(serial) ?? serial.trim().toUpperCase();
      let alreadyLoaded = false;
      if (!opts?.force) {
        if (scope === 'allTime') {
          setAllTimeCallsBySerial((prev) => {
            alreadyLoaded = prev.has(serialNorm) && (prev.get(serialNorm)?.length ?? 0) > 0;
            return prev;
          });
        } else {
          setWindowCallsBySerial((prev) => {
            alreadyLoaded = prev.has(serialNorm) && (prev.get(serialNorm)?.length ?? 0) > 0;
            return prev;
          });
        }
        if (alreadyLoaded) return;
      }

      setDetailLoading(`${scope}:${serialNorm}`);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const snap = getAppliedFiltersSnapshot();
        const params = buildSerialAuditDetailScopeParams({
          scope,
          startDate: startDateStr,
          endDate: endDateStr,
          callType: callTypeParam,
          repair: serializeRepairFilterParam(appliedRepairs),
          selectedBranch: snap?.selectedBranch ?? [],
          selectedFranchisee: snap?.selectedFranchisee ?? [],
          serial: serialNorm,
          refresh: opts?.force,
        });
        const res = await axios.get('/api/report/serial-audit', {
          headers,
          timeout: 120000,
          params,
        });
        const rawCalls = (res.data?.calls || []) as Record<string, unknown>[];
        const details = sortSerialAuditCallDetails(
          rawCalls.map(mapRowToSerialAuditCallDetail),
          'asc'
        );
        if (scope === 'allTime') {
          setAllTimeCallsBySerial((prev) => new Map(prev).set(serialNorm, details));
        } else {
          setWindowCallsBySerial((prev) => new Map(prev).set(serialNorm, details));
          if (details.length === 0) {
            setListRows((prev) => prev.filter((r) => r.serial !== serialNorm));
            setExpandedSerial((prev) => (prev === serialNorm ? null : prev));
          }
        }
      } catch (err: unknown) {
        const message = sanitizeUserFacingMessage(
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load call details'
        );
        feedback.actionFailed(message);
      } finally {
        setDetailLoading(null);
      }
    },
    [appliedRepairs, callTypeParam, endDateStr, getAppliedFiltersSnapshot, startDateStr, supabase]
  );

  const prefetchPagedWindowCalls = useCallback(
    async (rows: SerialAuditRow[]) => {
      if (!startDateStr || !endDateStr || rows.length === 0) return;

      const serialKeys = rows
        .map((r) => serialRowMatchKey(r))
        .filter((k) => k !== '__UNKNOWN__');
      const missing = serialKeys.filter((k) => !windowCallsRef.current.has(k));
      if (missing.length === 0) return;

      const prefetchKey = `${dataKey}|p${page}|${missing.join(',')}`;
      if (pagePrefetchInflightRef.current === prefetchKey) return;
      pagePrefetchInflightRef.current = prefetchKey;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const snap = getAppliedFiltersSnapshot();
        const scopeParams = snap
          ? buildSerialAuditApiScopeParams({
              startDate: startDateStr,
              endDate: endDateStr,
              callType: callTypeParam,
              repair: serializeRepairFilterParam(appliedRepairs),
              selectedBranch: snap.selectedBranch,
              selectedFranchisee: snap.selectedFranchisee,
            })
          : {
              startDate: startDateStr,
              endDate: endDateStr,
              callType: callTypeParam,
              repair: serializeRepairFilterParam(appliedRepairs),
            };

        const res = await axios.post(
          '/api/report/serial-audit/batch',
          {
            serials: missing.slice(0, SERIAL_PAGE_SIZE),
            startDate: startDateStr,
            endDate: endDateStr,
            callType: scopeParams.callType ?? callTypeParam,
            repair: scopeParams.repair ?? serializeRepairFilterParam(appliedRepairs),
            branch: scopeParams.branch ?? '',
            franchisee: scopeParams.franchisee ?? '',
          },
          { headers, timeout: 120000 }
        );

        const batchMap = buildCallsBySerialMap(
          ((res.data?.calls || []) as Record<string, unknown>[]) ?? []
        );
        setWindowCallsBySerial((prev) => {
          const next = new Map(prev);
          for (const [key, list] of batchMap) next.set(key, list);
          for (const key of missing) {
            if (!next.has(key)) next.set(key, []);
          }
          return next;
        });
      } catch {
        // Non-blocking — expand still loads via loadSerialDetails
      } finally {
        if (pagePrefetchInflightRef.current === prefetchKey) {
          pagePrefetchInflightRef.current = null;
        }
      }
    },
    [
      appliedRepairs,
      callTypeParam,
      dataKey,
      endDateStr,
      getAppliedFiltersSnapshot,
      page,
      startDateStr,
      supabase,
    ]
  );

  const skipRevisionReloadRef = useRef(true);
  useEffect(() => {
    if (!resourcesLoaded || !appliedFilters || !prefsReady) return;
    if (!defaultRepairsAppliedRef.current) return;
    if (skipRevisionReloadRef.current) {
      skipRevisionReloadRef.current = false;
      return;
    }
    void loadWindowData({ force: true });
  }, [appliedRevision, appliedFilters, loadWindowData, prefsReady, resourcesLoaded]);

  useEffect(() => {
    if (!resourcesLoaded) return;
    const cached = serialAuditBackgroundCache.get(dataKey);
    if (cached) {
      applyCachedSnapshot(cached);
      return;
    }
    lastPaintedKeyRef.current = null;
    setAnalysisCallsBySerial(new Map());
    setSelectedInvolvementPair(null);
    setListRows([]);
    setWindowCallsBySerial(new Map());
    setAllTimeCallsBySerial(new Map());
    setShowAllTimeFor(new Set());
    setExpandedSerial(null);
  }, [applyCachedSnapshot, dataKey, resourcesLoaded]);

  useEffect(() => {
    if (!expandedSerial) return;
    if (showAllTimeFor.has(expandedSerial)) return;
    const windowCalls = windowCallsBySerial.get(expandedSerial);
    if (windowCalls?.length) return;
    void loadSerialDetails(expandedSerial, 'window');
  }, [expandedSerial, loadSerialDetails, showAllTimeFor, windowCallsBySerial]);

  const allSerialRows = useMemo(
    () => deriveSerialAuditRowsForView(listRows, includeCancelled, MIN_REPEAT_COMPLAINTS),
    [listRows, includeCancelled]
  );

  const selectedPairKey = useMemo(
    () =>
      selectedInvolvementPair
        ? buildInvolvementPairKey(
            selectedInvolvementPair.technician,
            selectedInvolvementPair.franchisee
          )
        : null,
    [selectedInvolvementPair]
  );

  const selectedPairSerials = useMemo(
    () =>
      selectedInvolvementPair
        ? new Set(selectedInvolvementPair.serialKeys)
        : null,
    [selectedInvolvementPair]
  );

  const displayedRows = useMemo(() => {
    const filtered = filterSerialAuditRows(allSerialRows, {
      minCount,
      search: serialSearch,
      hideUnknown: true,
    });
    const withCalls = filtered.filter((row) =>
      serialAuditRowHasCallsInWindow(row, windowCallsBySerial, includeCancelled, {
        analysisCallsBySerial,
        involvementPair: selectedInvolvementPair,
      })
    );
    if (!selectedPairSerials) return withCalls;
    return withCalls.filter((row) => selectedPairSerials.has(serialRowMatchKey(row)));
  }, [
    allSerialRows,
    minCount,
    serialSearch,
    windowCallsBySerial,
    analysisCallsBySerial,
    includeCancelled,
    selectedPairSerials,
    selectedInvolvementPair,
  ]);

  const totalPages = Math.max(1, Math.ceil(displayedRows.length / SERIAL_PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [serialSearch, minCount, includeCancelled, filterParts, appliedRepairs, sort]);

  useEffect(() => {
    setPage(1);
    setExpandedSerial(null);
  }, [selectedInvolvementPair]);

  const handleApplyFilters = useCallback(() => {
    setAppliedRepairs(draftRepairs);
  }, [draftRepairs]);

  const handleClearAllFilters = useCallback(() => {
    setDraftRepairs([]);
    setAppliedRepairs([]);
  }, []);

  const extraActiveChips = useMemo((): ExtraActiveFilterChip[] => {
    if (appliedRepairs.length === 0) return [];
    if (appliedRepairs.length > REPAIR_CHIP_COLLAPSE_AT) {
      return [
        {
          id: 'repair:summary',
          label: `Repair: ${appliedRepairs.length} selected`,
          onRemove: () => {
            setDraftRepairs([]);
            setAppliedRepairs([]);
          },
        },
      ];
    }
    return appliedRepairs.map((value) => ({
      id: `repair:${value}`,
      label: `Repair: ${repairLabelForValue(value, repairLabelByValue)}`,
      onRemove: () => {
        const next = appliedRepairs.filter((v) => v !== value);
        setDraftRepairs(next);
        setAppliedRepairs(next);
      },
    }));
  }, [appliedRepairs, repairLabelByValue]);

  const extraFilterCount =
    appliedRepairs.length > REPAIR_CHIP_COLLAPSE_AT ? 1 : appliedRepairs.length;

  const repairDrawerExtra = (
    <div className="register-filter-group register-filter-group--stacked mt-2">
      <span className="register-filter-group-label">Repair done</span>
      <div className="register-filter-group-controls">
        <RegisterMultiSelect
          label="Repair"
          emptyLabel={
            repairOptionsLoading ? 'Loading repair types…' : 'All repair types'
          }
          options={repairOptions}
          selected={draftRepairs}
          onChange={setDraftRepairs}
          searchable
          showSelectAll
          selectAllLabel="All repair types"
          panelClassName="w-80"
          searchPlaceholder="Search repair type…"
        />
      </div>
      <p className="register-filter-drawer-hint">
        Filters calls with visit work from CRM repair master (motor, compressor, gas charging).
      </p>
    </div>
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const sortedDisplayedRows = useMemo(() => {
    if (!sort) return displayedRows;
    return sortRows(displayedRows, (row) => serialAuditSortValue(row, sort.key), sort.dir);
  }, [displayedRows, sort]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * SERIAL_PAGE_SIZE;
    return sortedDisplayedRows.slice(start, start + SERIAL_PAGE_SIZE);
  }, [sortedDisplayedRows, page]);

  useEffect(() => {
    if (loading || loadError || displayedRows.length === 0) return;
    const start = (page - 1) * SERIAL_PAGE_SIZE;
    const rows = displayedRows.slice(start, start + SERIAL_PAGE_SIZE);
    if (rows.length === 0) return;
    void prefetchPagedWindowCalls(rows);
  }, [loading, loadError, displayedRows, page, prefetchPagedWindowCalls]);

  const summary = useMemo(
    () => summarizeSerialAudit(allSerialRows),
    [allSerialRows]
  );
  const summaryWithCancelled = useMemo(
    () => listRows.filter((r) => r.cancelledCount > 0).length,
    [listRows]
  );

  const flaggedRowsForAnalysis = useMemo(
    () => allSerialRows.filter((row) => row.riskFlag && !row.isUnknownSerial),
    [allSerialRows]
  );

  const resolveSerialCalls = useCallback(
    (serialKey: string) =>
      resolveSerialAuditWindowCalls(serialKey, windowCallsBySerial, analysisCallsBySerial),
    [windowCallsBySerial, analysisCallsBySerial]
  );

  const repeatInvolvement = useMemo(() => {
    if (!showAspBreakdown) {
      return {
        entries: [],
        repeatCallCount: 0,
        serialsInScope: 0,
        serialsWithDetails: 0,
        detailsPending: false,
      };
    }
    return computeRepeatInvolvementAnalysis(
      flaggedRowsForAnalysis,
      windowCallsBySerial,
      includeCancelled,
      resolveSerialCalls
    );
  }, [
    showAspBreakdown,
    flaggedRowsForAnalysis,
    windowCallsBySerial,
    analysisCallsBySerial,
    includeCancelled,
    resolveSerialCalls,
  ]);

  const listBodyLayoutClass = showAspBreakdown
    ? 'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch [&>*]:min-h-0'
    : 'min-h-0 flex-1';

  const handleSerialSort = (key: SerialAuditSortKey) => {
    setSort((p) =>
      toggleSort(
        p,
        key,
        key === 'serial' || key === 'branches' || key === 'customers' ? 'asc' : 'desc'
      )
    );
  };

  const toggleExpand = (serial: string) => {
    setExpandedSerial((prev) => {
      if (prev === serial) {
        setShowAllTimeFor((s) => {
          const next = new Set(s);
          next.delete(serial);
          return next;
        });
        return null;
      }
      return serial;
    });
  };

  const handleShowAllTimeChange = useCallback(
    (serial: string, enabled: boolean) => {
      const serialNorm = normalizeSerial(serial) ?? serial.trim().toUpperCase();
      setShowAllTimeFor((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(serialNorm);
        else next.delete(serialNorm);
        return next;
      });
      if (enabled) {
        void loadSerialDetails(serialNorm, 'allTime', { force: true });
      }
    },
    [loadSerialDetails]
  );

  if (!mounted || !resourcesLoaded) {
    return (
      <PageShell title="Serial Audit" icon={<ScanBarcode className="h-4 w-4" />}>
        <ReportLoadingPanel label="Loading filters…" className="m-4 flex-1" />
      </PageShell>
    );
  }

  const listUpdating = loading && listRows.length > 0;

  return (
    <PageShell
      title="Serial Audit"
      subtitle="Repeat service visits in the selected date range — expand for call details"
      icon={<ScanBarcode className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWindowData({ refresh: true })}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-bg-soft disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-bg-canvas px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-bg-soft"
          >
            <ExternalLink className="h-3 w-3" />
            Call Register
          </Link>
        </div>
      }
      toolbar={
        <RegisterPageFilters
          updating={listUpdating}
          updatingLabel="Updating serial audit…"
          onApply={handleApplyFilters}
          onClearAll={handleClearAllFilters}
          drawerExtra={repairDrawerExtra}
          extraActiveChips={extraActiveChips}
          extraFilterCount={extraFilterCount}
        />
      }
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft p-4"
    >
      <div className="flex shrink-0 flex-col gap-3">
      <SerialRepairLegend />
      <div className="flex flex-wrap items-center gap-2">
        <AdminStatPill label="Repeated serials" value={loading && listRows.length === 0 ? '…' : summary.totalSerials} />
        <AdminStatPill label="Flagged (≥3)" value={loading && listRows.length === 0 ? '…' : summary.flaggedCount} />
        <AdminStatPill
          label="With cancelled"
          value={loading && listRows.length === 0 ? '…' : summaryWithCancelled}
        />
        <AdminStatPill label="Max complaints" value={loading && listRows.length === 0 ? '…' : summary.maxComplaints} />
      </div>

      <AdminToolbar
        search={serialSearch}
        onSearchChange={setSerialSearch}
        searchPlaceholder="Search serial number…"
      >
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="text-slate-400">Min repeats</span>
          <input
            type="number"
            min={MIN_REPEAT_COMPLAINTS}
            max={99}
            value={minCount}
            onChange={(e) =>
              setMinCount(Math.max(MIN_REPEAT_COMPLAINTS, Number(e.target.value) || MIN_REPEAT_COMPLAINTS))
            }
            className="w-14 rounded border border-slate-200 px-2 py-1 text-[11px]"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
            className="rounded border-slate-300"
          />
          Include cancelled
        </label>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600"
          title="Side panel for ASP / technician repeat-call breakdown (extra server query)"
        >
          <input
            type="checkbox"
            checked={showAspBreakdown}
            onChange={(e) => setShowAspBreakdown(e.target.checked)}
            className="rounded border-slate-300"
          />
          ASP involvement panel
        </label>
        <button
          type="button"
          disabled={loading || displayedRows.length === 0}
          onClick={() => {
            try {
              const stamp = new Date().toISOString().slice(0, 10);
              const csv = exportSerialAuditCsv(displayedRows);
              void triggerBlobDownload(
                new Blob([csv], { type: 'text/csv;charset=utf-8' }),
                `serial-audit-${stamp}.csv`
              );
              feedback.actionSuccess('CSV download started');
            } catch (err) {
              console.error(err);
              feedback.actionFailed('CSV export failed');
            }
          }}
          className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-bg-canvas px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-bg-soft disabled:opacity-50"
          title="Download filtered serial list as CSV"
        >
          <Download size={13} />
          CSV
        </button>
      </AdminToolbar>
      </div>

      <PageScrollRegion>
      <div className="flex min-h-0 flex-1 flex-col pt-3">
      {loading && listRows.length === 0 ? (
        <div className={listBodyLayoutClass}>
          <ReportLoadingPanel
            label="Finding repeated serial numbers"
            sublabel="Running a focused scan for your date range."
          />
          {showAspBreakdown ? (
            <SerialAuditAnalysisPanel
              analysis={repeatInvolvement}
              dateRangeLabel={dateRangeLabel}
              loading
              selectedPairKey={selectedPairKey}
              onPairSelect={setSelectedInvolvementPair}
            />
          ) : null}
        </div>
      ) : loadError && listRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/50 p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-medium text-slate-700">Could not load serial audit data</p>
          <p className="max-w-md text-[11px] text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadWindowData({ refresh: true })}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      ) : listRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-bg-canvas p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-700">No repeat serials found</p>
          <p className="max-w-md text-[11px] text-slate-500">
            No device serial has {MIN_REPEAT_COMPLAINTS} or more
            {includeCancelled ? ' calls (including cancelled)' : ' non-cancelled calls'} in the selected date range.
          </p>
        </div>
      ) : (
        <div className={listBodyLayoutClass}>
          <AdminTableCard
            isEmpty={displayedRows.length === 0}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">
                  {selectedInvolvementPair
                    ? 'No serials for this ASP / technician in the current filters'
                    : 'No serials match filters'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {selectedInvolvementPair ? (
                    <button
                      type="button"
                      className="mt-2 font-medium text-amber-800 underline"
                      onClick={() => setSelectedInvolvementPair(null)}
                    >
                      Clear ASP / technician filter
                    </button>
                  ) : (
                    'Lower "Min repeats" or clear the serial search.'
                  )}
                </p>
              </>
            }
          >
            <DataTableLoading
              loading={false}
              updating={listUpdating}
              hasContent={displayedRows.length > 0}
              updatingLabel="Refreshing serial list…"
            >
            {selectedInvolvementPair ? (
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2">
                <p className="text-[11px] text-amber-950">
                  <span className="font-semibold">{displayedRows.length}</span> serial
                  {displayedRows.length === 1 ? '' : 's'} for{' '}
                  <span className="font-semibold">{selectedInvolvementPair.franchisee}</span>
                  {selectedInvolvementPair.technician !== '—' ? (
                    <>
                      {' '}
                      · <span className="font-semibold">{selectedInvolvementPair.technician}</span>
                    </>
                  ) : null}
                  . Counts in the table match the expanded call list for this ASP / technician.
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedInvolvementPair(null)}
                  className="rounded-md border border-amber-200 bg-bg-canvas px-2 py-1 text-[10px] font-medium text-amber-900 hover:bg-amber-100"
                >
                  Show all serials
                </button>
              </div>
            ) : null}
            <AdminTable>
              <AdminThead>
                <tr>
                  <AdminTh className="w-8">
                    <span className="sr-only">Expand</span>
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="serial"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Serial
                  </AdminTh>
                  <AdminTh
                    align="right"
                    sortable
                    sortKey="complaints"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    <span
                      title={
                        selectedInvolvementPair
                          ? 'Calls for selected ASP / technician (same as expanded list)'
                          : 'Calls on this serial in the selected range'
                      }
                    >
                      {selectedInvolvementPair ? 'Calls' : 'Complaints'}
                    </span>
                  </AdminTh>
                  <AdminTh
                    align="right"
                    sortable
                    sortKey="open"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Open
                  </AdminTh>
                  <AdminTh
                    align="right"
                    sortable
                    sortKey="solved"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Solved
                  </AdminTh>
                  {includeCancelled ? (
                    <AdminTh
                      align="right"
                      sortable
                      sortKey="cancelled"
                      sort={sort}
                      onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                    >
                      Cancelled
                    </AdminTh>
                  ) : null}
                  <AdminTh
                    sortable
                    sortKey="branches"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Branches
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="customers"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Customers
                  </AdminTh>
                  <AdminTh
                    sortable
                    sortKey="lastDate"
                    sort={sort}
                    onSort={(k) => handleSerialSort(k as SerialAuditSortKey)}
                  >
                    Last date
                  </AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {pagedRows.map((row) => {
                  const serialKey = serialRowMatchKey(row);
                  return (
                    <SerialAuditTableRow
                      key={row.serial}
                      row={row}
                      windowCalls={windowCallsBySerial.get(serialKey) ?? []}
                      allTimeCalls={allTimeCallsBySerial.get(serialKey) ?? []}
                      showAllTime={showAllTimeFor.has(serialKey)}
                      onShowAllTimeChange={(enabled) =>
                        handleShowAllTimeChange(serialKey, enabled)
                      }
                      involvementCalls={
                        selectedInvolvementPair
                          ? resolveSerialCalls(serialKey)
                          : undefined
                      }
                      callsLoaded={serialAuditCallsLoadedForKey(
                        serialKey,
                        windowCallsBySerial,
                        analysisCallsBySerial
                      )}
                      selectedInvolvementPair={selectedInvolvementPair}
                      dateRangeLabel={dateRangeLabel}
                      registerLinkContext={registerLinkContext}
                      detailLoading={
                        detailLoading === `window:${serialKey}` ||
                        detailLoading === `allTime:${serialKey}`
                      }
                      expanded={expandedSerial === row.serial}
                      includeCancelled={includeCancelled}
                      onToggle={() => toggleExpand(row.serial)}
                    />
                  );
                })}
              </tbody>
            </AdminTable>
            {displayedRows.length > SERIAL_PAGE_SIZE ? (
              <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-bg-soft px-3 py-2">
                <span className="text-[11px] text-slate-500">
                  {(page - 1) * SERIAL_PAGE_SIZE + 1}–
                  {Math.min(page * SERIAL_PAGE_SIZE, displayedRows.length)} of{' '}
                  {displayedRows.length.toLocaleString()} serials
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-slate-200 bg-bg-canvas p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[4rem] text-center text-[11px] font-medium text-slate-700">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-slate-200 bg-bg-canvas p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
            </DataTableLoading>
          </AdminTableCard>

          {showAspBreakdown ? (
            <SerialAuditAnalysisPanel
              analysis={repeatInvolvement}
              dateRangeLabel={dateRangeLabel}
              loading={loading && listRows.length === 0}
              prefetching={analysisLoading}
              selectedPairKey={selectedPairKey}
              onPairSelect={setSelectedInvolvementPair}
            />
          ) : null}
        </div>
      )}
      </div>
      </PageScrollRegion>
    </PageShell>
  );
}

function SerialRepairCountBadges({
  counts,
}: {
  counts: SerialAuditRepairCounts;
}) {
  const items = [
    { key: 'motor', label: 'Motor', value: counts.motorReplaced, className: repairSemantics.motor },
    {
      key: 'compressor',
      label: 'Compressor',
      value: counts.compressorReplaced,
      className: repairSemantics.compressor,
    },
    { key: 'gas', label: 'Gas', value: counts.gasCharging, className: repairSemantics.gas },
  ].filter((item) => item.value > 0);

  if (items.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.key}
          title={`${item.label}: ${item.value}`}
          className={`rounded px-1 py-0.5 text-[14px] font-medium tabular-nums ${item.className}`}
        >
          {item.label} {item.value}
        </span>
      ))}
    </span>
  );
}

function SerialAuditTableRow({
  row,
  windowCalls,
  allTimeCalls,
  showAllTime,
  onShowAllTimeChange,
  involvementCalls,
  callsLoaded,
  selectedInvolvementPair,
  dateRangeLabel,
  registerLinkContext,
  detailLoading,
  expanded,
  includeCancelled,
  onToggle,
}: {
  row: SerialAuditRow;
  windowCalls: SerialAuditCallDetail[];
  allTimeCalls: SerialAuditCallDetail[];
  showAllTime: boolean;
  onShowAllTimeChange: (enabled: boolean) => void;
  involvementCalls?: SerialAuditCallDetail[];
  callsLoaded: boolean;
  selectedInvolvementPair: RepeatInvolvementEntry | null;
  dateRangeLabel: string;
  registerLinkContext?: Omit<RegisterDeepLinkParams, 'search'>;
  detailLoading: boolean;
  expanded: boolean;
  includeCancelled: boolean;
  onToggle: () => void;
}) {
  const flagged = row.riskFlag;
  const rowBg = flagged ? 'bg-amber-50/80 hover:bg-amber-50' : '';

  const involvementPair = selectedInvolvementPair
    ? {
        technician: selectedInvolvementPair.technician,
        franchisee: selectedInvolvementPair.franchisee,
      }
    : null;

  const rawCalls = involvementCalls ?? (showAllTime ? allTimeCalls : windowCalls);

  const displayCalls = useMemo(
    () => getSerialAuditDisplayCalls(rawCalls, includeCancelled, involvementPair),
    [rawCalls, includeCancelled, involvementPair]
  );

  const displayCounts = useMemo(
    () => summarizeSerialAuditCalls(displayCalls),
    [displayCalls]
  );

  const displayMeta = useMemo(() => serialAuditMetaFromCalls(displayCalls), [displayCalls]);

  const counts = involvementCalls
    ? displayCounts
    : callsLoaded
      ? displayCounts
      : summarizeSerialAuditCalls([]);
  const showListFallback = !involvementCalls && !callsLoaded;
  const complaintCount = showListFallback ? row.complaintCount : counts.complaintCount;
  const openCount = showListFallback ? row.openCount : counts.openCount;
  const solvedCount = showListFallback ? row.solvedCount : counts.solvedCount;
  const cancelledCount = showListFallback ? row.cancelledCount : counts.cancelledCount;
  const uniqueBranches = showListFallback ? row.uniqueBranches : displayMeta.uniqueBranches;
  const uniqueCustomers = showListFallback ? row.uniqueCustomers : displayMeta.uniqueCustomers;
  const lastComplaintDate = showListFallback
    ? row.lastComplaintDate
    : displayMeta.lastComplaintDate;

  const repairBadgeCounts = useMemo(() => {
    if (showListFallback) return row.repairCounts;
    return countRepairsFromCallRows(
      displayCalls.map((call) => ({ repair_done: call.repairDone }))
    );
  }, [showListFallback, displayCalls, row.repairCounts]);

  const allTimeLoading = showAllTime && detailLoading && allTimeCalls.length === 0;
  const windowLoading = !showAllTime && !involvementCalls && detailLoading && windowCalls.length === 0;
  const callsLoading = involvementCalls ? detailLoading && displayCalls.length === 0 : allTimeLoading || windowLoading;

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
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={flagged ? 'font-semibold text-amber-900' : 'text-slate-800'}>
              {row.serial}
            </span>
            <SerialRepairCountBadges counts={repairBadgeCounts} />
            {/* {flagged ? (
              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-900">
                Flagged (Repeat-Complaints)
              </span>
            ) : null} */}
          </div>
        </AdminTd>
        <AdminTd align="right" className={`font-semibold tabular-nums ${rowBg}`}>
          {callsLoading ? (
            <span className="text-slate-400">…</span>
          ) : (
            complaintCount
          )}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-blue-700 ${rowBg}`}>
          {callsLoading ? <span className="text-slate-400">…</span> : openCount}
        </AdminTd>
        <AdminTd align="right" className={`tabular-nums text-emerald-700 ${rowBg}`}>
          {callsLoading ? <span className="text-slate-400">…</span> : solvedCount}
        </AdminTd>
        {includeCancelled ? (
          <AdminTd align="right" className={`tabular-nums text-rose-700 ${rowBg}`}>
            {callsLoading ? <span className="text-slate-400">…</span> : cancelledCount}
          </AdminTd>
        ) : null}
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {uniqueBranches.length > 0
            ? uniqueBranches.slice(0, 2).join(', ') +
              (uniqueBranches.length > 2 ? ` +${uniqueBranches.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`max-w-[140px] truncate text-[11px] ${rowBg}`}>
          {uniqueCustomers.length > 0
            ? uniqueCustomers.slice(0, 2).join(', ') +
              (uniqueCustomers.length > 2 ? ` +${uniqueCustomers.length - 2}` : '')
            : '—'}
        </AdminTd>
        <AdminTd className={`whitespace-nowrap text-[11px] text-slate-600 ${rowBg}`}>
          {lastComplaintDate ? formatUiDate(lastComplaintDate) || '—' : '—'}
        </AdminTd>
      </AdminTr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-bg-soft/80">
          <td colSpan={includeCancelled ? 9 : 8} className="serial-audit-expanded-cell px-3 py-3">
            {displayCalls.length === 0 && !allTimeLoading && !windowLoading && !callsLoading ? (
              <p className="py-4 text-center text-[11px] text-slate-500">
                {selectedInvolvementPair
                  ? `No repeat calls for ${selectedInvolvementPair.franchisee}${
                      selectedInvolvementPair.technician !== '—'
                        ? ` · ${selectedInvolvementPair.technician}`
                        : ''
                    } on this serial.`
                  : showAllTime
                    ? 'No all-time calls found for this serial.'
                    : 'No calls for this serial in the selected date range.'}
              </p>
            ) : (
              <SerialAuditCallsDetailTable
                calls={displayCalls}
                serial={row.serial}
                scope={showAllTime ? 'allTime' : 'window'}
                dateRangeLabel={dateRangeLabel}
                registerLinkContext={registerLinkContext}
                loading={windowLoading}
                showAllTime={showAllTime}
                onShowAllTimeChange={
                  selectedInvolvementPair ? undefined : onShowAllTimeChange
                }
                allTimeLoading={allTimeLoading || windowLoading}
                allTimeCount={
                  allTimeCalls.length > 0 ? allTimeCalls.length : undefined
                }
                scopeHint={
                  selectedInvolvementPair
                    ? `Repeat calls for ${selectedInvolvementPair.franchisee}${
                        selectedInvolvementPair.technician !== '—'
                          ? ` · ${selectedInvolvementPair.technician}`
                          : ''
                      }`
                    : undefined
                }
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
