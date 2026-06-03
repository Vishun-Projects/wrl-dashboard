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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { RegisterPageFilters } from '@/components/RegisterPageFilters';
import { RegisterMultiSelect } from '@/components/RegisterMultiSelect';
import { ReportLoadingPanel } from '@/components/ReportLoadingFeedback';
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
import { buildCorpusCacheKey } from '@/lib/report-corpus';
import { sanitizeUserFacingMessage } from '@/lib/user-facing-errors';
import { appliedFilterPartsFromSnapshot, toDateString } from '@/lib/report-filters';
import { callCorpusStore } from '@/lib/report-data-store';
import { MAX_CLIENT_CORPUS_DAYS } from '@/lib/trhcalls-query';
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
} from '@/lib/serial-audit-repair-options';
import {
  aggregateComplaintsBySerial,
  buildCallsBySerialMap,
  computeRepeatInvolvementAnalysis,
  deriveSerialAuditRowsForView,
  filterSerialAuditCallsForView,
  serialAuditRowHasCallsInWindow,
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
} from '@/lib/serial-complaint-audit';
import type { ExtraActiveFilterChip } from '@/lib/report-filters';
import { SerialAuditCallsDetailTable } from '@/components/SerialAuditCallsDetailTable';
import { SerialAuditAnalysisPanel } from '@/components/SerialAuditAnalysisPanel';
import { toast } from 'sonner';

const DEFAULT_RISK_THRESHOLD = 3;
const SERIAL_PAGE_SIZE = 25;

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
    reportPreferences,
    prefsReady,
    schedulePatchReportPreferences,
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
          },
    [appliedFilters]
  );

  const dateFilterColumn = appliedFilters?.dateFilterColumn ?? 'dtrndate';

  const dateRangeLabel = useMemo(
    () => `${startDateStr} → ${endDateStr}`,
    [startDateStr, endDateStr]
  );

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
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [expandedSerial, setExpandedSerial] = useState<string | null>(null);
  const [listRows, setListRows] = useState<SerialAuditRow[]>([]);
  const [windowCallsBySerial, setWindowCallsBySerial] = useState<Map<string, SerialAuditCallDetail[]>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [analysisCallsBySerial, setAnalysisCallsBySerial] = useState<
    Map<string, SerialAuditCallDetail[]>
  >(new Map());
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const lastPaintedKeyRef = useRef<string | null>(null);
  const defaultRepairsAppliedRef = useRef(false);
  const serialPrefsRestoredRef = useRef(false);

  useEffect(() => {
    if (!prefsReady || serialPrefsRestoredRef.current) return;
    serialPrefsRestoredRef.current = true;
    const sa = reportPreferences?.serialAudit;
    if (!sa) return;
    if (sa.appliedRepairs?.length) {
      setDraftRepairs(sa.appliedRepairs);
      setAppliedRepairs(sa.appliedRepairs);
    }
    if (typeof sa.minCount === 'number') setMinCount(sa.minCount);
    if (sa.onlyFlagged) setOnlyFlagged(true);
    if (sa.includeCancelled) setIncludeCancelled(true);
  }, [prefsReady, reportPreferences]);

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
      toast.error(message);
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
      start: string,
      end: string,
      callType: string
    ): Promise<Map<string, SerialAuditRepairCounts>> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await axios.get('/api/report/serial-audit/repair-counts', {
        headers,
        timeout: 120000,
        params: { startDate: start, endDate: end, callType },
      });
      const bySerial = (res.data?.bySerial || {}) as Record<string, SerialAuditRepairCounts>;
      const map = new Map<string, SerialAuditRepairCounts>();
      for (const [serial, counts] of Object.entries(bySerial)) {
        map.set(serial.trim().toUpperCase(), counts);
      }
      return map;
    },
    [supabase]
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

      const existingInflight = serialAuditBackgroundInflight.get(loadDataKey);
      if (existingInflight && !opts?.force && !opts?.refresh) {
        await existingInflight;
        const cached = serialAuditBackgroundCache.get(loadDataKey);
        if (cached) {
          applyCachedSnapshot(cached);
          lastPaintedKeyRef.current = loadDataKey;
        }
        return;
      }

      if (!opts?.refresh && !opts?.force && lastPaintedKeyRef.current === loadDataKey) {
        const cached = serialAuditBackgroundCache.get(loadDataKey);
        if (cached) {
          applyCachedSnapshot(cached);
          lastPaintedKeyRef.current = loadDataKey;
          return;
        }
      }

      const run = (async () => {
        if (opts?.refresh) {
          lastPaintedKeyRef.current = null;
          serialAuditBackgroundCache.delete(loadDataKey);
        }

        setLoadError(null);
        setExpandedSerial(null);
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
              loadStartDateStr,
              loadEndDateStr,
              loadCallTypeParam
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
            params: {
              startDate: loadStartDateStr,
              endDate: loadEndDateStr,
              callType: loadCallTypeParam,
              repair: loadRepairParam,
              minRepeats: MIN_REPEAT_COMPLAINTS,
              includeAnalysisCalls: 'true',
              riskThreshold: DEFAULT_RISK_THRESHOLD,
              ...(opts?.refresh ? { refresh: 'true' } : {}),
            },
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
          const analysisCalls = buildCallsBySerialMap(
            ((res.data?.analysisCalls || []) as Record<string, unknown>[]) ?? []
          );
          setListRows(apiRows);
          setWindowCallsBySerial(emptyWindowCalls);
          setAnalysisCallsBySerial(analysisCalls);
          lastPaintedKeyRef.current = loadDataKey;
          serialAuditBackgroundCache.set(loadDataKey, {
            rows: apiRows,
            windowCalls: emptyWindowCalls,
            analysisCalls,
          });
        } catch (err: unknown) {
          const message = sanitizeUserFacingMessage(
            axios.isAxiosError(err) && err.response?.data?.error
              ? String(err.response.data.error)
              : err instanceof Error
                ? err.message
                : 'Failed to load serial audit data'
          );
          setLoadError(message);
          toast.error(message);
        } finally {
          setLoading(false);
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
      supabase,
    ]
  );

  useEffect(() => {
    if (!resourcesLoaded || !appliedFilters || !prefsReady) return;
    if (repairPickerItems.length === 0) return;
    if (defaultRepairsAppliedRef.current) return;
    defaultRepairsAppliedRef.current = true;

    const saved = reportPreferences?.serialAudit?.appliedRepairs;
    if (saved?.length) {
      void loadWindowData({ force: true, repairs: saved });
      return;
    }

    const defaults = defaultSerialAuditRepairFilterValues(repairPickerItems);
    setDraftRepairs(defaults);
    setAppliedRepairs(defaults);
    void loadWindowData({ force: true, repairs: defaults });
  }, [
    appliedFilters,
    loadWindowData,
    prefsReady,
    repairPickerItems,
    reportPreferences,
    resourcesLoaded,
  ]);

  useEffect(() => {
    if (!prefsReady || !defaultRepairsAppliedRef.current) return;
    schedulePatchReportPreferences({
      serialAudit: {
        appliedRepairs,
        minCount,
        onlyFlagged,
        includeCancelled,
      },
    });
  }, [
    appliedRepairs,
    minCount,
    onlyFlagged,
    includeCancelled,
    prefsReady,
    schedulePatchReportPreferences,
  ]);

  const loadSerialDetails = useCallback(
    async (serial: string) => {
      let alreadyLoaded = false;
      setWindowCallsBySerial((prev) => {
        alreadyLoaded = prev.has(serial) && (prev.get(serial)?.length ?? 0) > 0;
        return prev;
      });
      if (alreadyLoaded) return;

      const serialNorm = normalizeSerial(serial) ?? serial.trim().toUpperCase();
      setDetailLoading(serialNorm);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const headers = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const res = await axios.get('/api/report/serial-audit', {
          headers,
          timeout: 120000,
          params: {
            callType: callTypeParam,
            repair: serializeRepairFilterParam(appliedRepairs),
            serial: serialNorm,
            startDate: startDateStr,
            endDate: endDateStr,
          },
        });
        const rawCalls = (res.data?.calls || []) as Record<string, unknown>[];
        const details = sortSerialAuditCallDetails(
          rawCalls.map(mapRowToSerialAuditCallDetail),
          'asc'
        );
        setWindowCallsBySerial((prev) => new Map(prev).set(serialNorm, details));
        if (details.length === 0) {
          setListRows((prev) => prev.filter((r) => r.serial !== serialNorm));
          setExpandedSerial((prev) => (prev === serialNorm ? null : prev));
        }
      } catch (err: unknown) {
        const message = sanitizeUserFacingMessage(
          axios.isAxiosError(err) && err.response?.data?.error
            ? String(err.response.data.error)
            : err instanceof Error
              ? err.message
              : 'Failed to load call details'
        );
        toast.error(message);
      } finally {
        setDetailLoading(null);
      }
    },
    [appliedRepairs, callTypeParam, endDateStr, startDateStr, supabase]
  );

  useEffect(() => {
    if (!resourcesLoaded) return;
    const cached = serialAuditBackgroundCache.get(dataKey);
    if (cached) {
      applyCachedSnapshot(cached);
      return;
    }
    lastPaintedKeyRef.current = null;
    setAnalysisCallsBySerial(new Map());
    setListRows([]);
    setWindowCallsBySerial(new Map());
    setExpandedSerial(null);
  }, [applyCachedSnapshot, dataKey, resourcesLoaded]);

  useEffect(() => {
    if (!expandedSerial) return;
    const windowCalls = windowCallsBySerial.get(expandedSerial);
    if (windowCalls?.length) return;
    void loadSerialDetails(expandedSerial);
  }, [expandedSerial, loadSerialDetails, windowCallsBySerial]);

  const allSerialRows = useMemo(
    () => deriveSerialAuditRowsForView(listRows, includeCancelled, MIN_REPEAT_COMPLAINTS),
    [listRows, includeCancelled]
  );

  const displayedRows = useMemo(() => {
    const filtered = filterSerialAuditRows(allSerialRows, {
      minCount: onlyFlagged ? DEFAULT_RISK_THRESHOLD : minCount,
      search: serialSearch,
      onlyFlagged,
      hideUnknown: true,
    });
    return filtered.filter((row) =>
      serialAuditRowHasCallsInWindow(row, windowCallsBySerial, includeCancelled)
    );
  }, [
    allSerialRows,
    minCount,
    serialSearch,
    onlyFlagged,
    windowCallsBySerial,
    includeCancelled,
  ]);

  const totalPages = Math.max(1, Math.ceil(displayedRows.length / SERIAL_PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [serialSearch, minCount, onlyFlagged, includeCancelled, filterParts, appliedRepairs]);

  const handleApplyFilters = useCallback(() => {
    setAppliedRepairs(draftRepairs);
    void loadWindowData({ force: true, repairs: draftRepairs });
  }, [draftRepairs, loadWindowData]);

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

  const pagedRows = useMemo(() => {
    const start = (page - 1) * SERIAL_PAGE_SIZE;
    return displayedRows.slice(start, start + SERIAL_PAGE_SIZE);
  }, [displayedRows, page]);

  const summary = useMemo(
    () => summarizeSerialAudit(allSerialRows, DEFAULT_RISK_THRESHOLD),
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

  const analysisCallsSource = useMemo(() => {
    const corpusReady =
      flaggedRowsForAnalysis.length > 0 &&
      flaggedRowsForAnalysis.every(
        (row) => (windowCallsBySerial.get(serialRowMatchKey(row))?.length ?? 0) > 0
      );
    return corpusReady ? windowCallsBySerial : analysisCallsBySerial;
  }, [analysisCallsBySerial, flaggedRowsForAnalysis, windowCallsBySerial]);

  const repeatInvolvement = useMemo(
    () =>
      computeRepeatInvolvementAnalysis(
        flaggedRowsForAnalysis,
        analysisCallsSource,
        includeCancelled
      ),
    [analysisCallsSource, flaggedRowsForAnalysis, includeCancelled]
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
      subtitle="Repeat service visits in the selected date range — expand for call details"
      icon={<ScanBarcode className="h-4 w-4" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadWindowData({ refresh: true })}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/report"
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-3 w-3" />
            Call Register
          </Link>
        </div>
      }
      toolbar={
        <RegisterPageFilters
          loading={loading && listRows.length === 0}
          loadingLabel="Loading repeated serial numbers…"
          onApply={handleApplyFilters}
          onClearAll={handleClearAllFilters}
          drawerExtra={repairDrawerExtra}
          extraActiveChips={extraActiveChips}
          extraFilterCount={extraFilterCount}
        />
      }
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-slate-50 p-4"
    >
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <AdminStatPill label="Repeated serials" value={loading ? '…' : summary.totalSerials} />
        <AdminStatPill label="Flagged (≥3)" value={loading ? '…' : summary.flaggedCount} />
        <AdminStatPill
          label="With cancelled"
          value={loading ? '…' : summaryWithCancelled}
        />
        <AdminStatPill label="Max complaints" value={loading ? '…' : summary.maxComplaints} />
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
            disabled={onlyFlagged}
            onChange={(e) =>
              setMinCount(Math.max(MIN_REPEAT_COMPLAINTS, Number(e.target.value) || MIN_REPEAT_COMPLAINTS))
            }
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
          Flagged (Repeat-Complaints) only
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
      </AdminToolbar>

      {loading && listRows.length === 0 ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch">
          <ReportLoadingPanel
            label="Finding repeated serial numbers"
            sublabel="Running a focused scan for your date range."
          />
          <SerialAuditAnalysisPanel
            analysis={repeatInvolvement}
            dateRangeLabel={dateRangeLabel}
            loading
          />
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium text-slate-700">No repeat serials found</p>
          <p className="max-w-md text-[11px] text-slate-500">
            No device serial has {MIN_REPEAT_COMPLAINTS} or more
            {includeCancelled ? ' calls (including cancelled)' : ' non-cancelled calls'} in the selected date range.
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-stretch">
          <AdminTableCard
            isEmpty={displayedRows.length === 0}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">No serials match filters</p>
                <p className="text-[11px] text-slate-400">
                  Lower &quot;Min repeats&quot; or clear &quot;Flagged only&quot;.
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
                  {includeCancelled ? <AdminTh align="right">Cancelled</AdminTh> : null}
                  <AdminTh>Branches</AdminTh>
                  <AdminTh>Customers</AdminTh>
                  <AdminTh>Last date</AdminTh>
                </tr>
              </AdminThead>
              <tbody>
                {pagedRows.map((row) => (
                  <SerialAuditTableRow
                    key={row.serial}
                    row={row}
                    windowCalls={windowCallsBySerial.get(row.serial) ?? []}
                    dateRangeLabel={dateRangeLabel}
                    detailLoading={detailLoading === row.serial}
                    expanded={expandedSerial === row.serial}
                    includeCancelled={includeCancelled}
                    onToggle={() => toggleExpand(row.serial)}
                  />
                ))}
              </tbody>
            </AdminTable>
            {displayedRows.length > SERIAL_PAGE_SIZE ? (
              <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2">
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
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
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
                    className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </AdminTableCard>

          <SerialAuditAnalysisPanel
            analysis={repeatInvolvement}
            dateRangeLabel={dateRangeLabel}
            loading={loading}
          />
        </div>
      )}
    </PageShell>
  );
}

function SerialRepairCountBadges({
  counts,
}: {
  counts: SerialAuditRepairCounts;
}) {
  const items = [
    { key: 'motor', label: 'Motor', value: counts.motorReplaced, className: 'bg-violet-100 text-violet-800' },
    {
      key: 'compressor',
      label: 'Compressor',
      value: counts.compressorReplaced,
      className: 'border border-rose-300/80 bg-[#ffaeae] text-black font-bold',
    },
    { key: 'gas', label: 'Gas', value: counts.gasCharging, className: 'bg-teal-100 text-teal-800' },
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
  dateRangeLabel,
  detailLoading,
  expanded,
  includeCancelled,
  onToggle,
}: {
  row: SerialAuditRow;
  windowCalls: SerialAuditCallDetail[];
  dateRangeLabel: string;
  detailLoading: boolean;
  expanded: boolean;
  includeCancelled: boolean;
  onToggle: () => void;
}) {
  const flagged = row.riskFlag;
  const rowBg = flagged ? 'bg-amber-50/80 hover:bg-amber-50' : '';
  const displayCalls = useMemo(
    () => filterSerialAuditCallsForView(windowCalls, includeCancelled),
    [windowCalls, includeCancelled]
  );
  const callsLoading = detailLoading && windowCalls.length === 0;

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
              {row.serial} ~
            </span>
            <SerialRepairCountBadges counts={row.repairCounts} />
            {/* {flagged ? (
              <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-900">
                Flagged (Repeat-Complaints)
              </span>
            ) : null} */}
          </div>
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
        {includeCancelled ? (
          <AdminTd align="right" className={`tabular-nums text-rose-700 ${rowBg}`}>
            {row.cancelledCount}
          </AdminTd>
        ) : null}
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
          {row.lastComplaintDate ? row.lastComplaintDate.slice(0, 10) : '—'}
        </AdminTd>
      </AdminTr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50/80">
          <td colSpan={includeCancelled ? 9 : 8} className="px-3 py-3">
            {displayCalls.length === 0 && !callsLoading ? (
              <p className="py-4 text-center text-[11px] text-slate-500">
                No calls for this serial in the selected date range.
              </p>
            ) : (
              <SerialAuditCallsDetailTable
                calls={displayCalls}
                serial={row.serial}
                dateRangeLabel={dateRangeLabel}
                loading={callsLoading}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
