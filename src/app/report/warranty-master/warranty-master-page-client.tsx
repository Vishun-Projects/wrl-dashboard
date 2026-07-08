'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Shield, X } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { WarrantyMasterToolbar } from '@/components/warranty-master/WarrantyMasterToolbar';
import { WarrantyMasterHeaderActions } from '@/components/warranty-master/WarrantyMasterHeaderActions';
import { WarrantyMasterSummaryPanel } from '@/components/warranty-master/WarrantyMasterSummaryPanel';
import { WarrantyMasterTable } from '@/components/warranty-master/WarrantyMasterTable';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { AnimatedChipList } from '@/components/motion';
import {
  aggregateWarrantyMasterFgLines,
  aggregateRowKey,
  buildWarrantyMasterDimsFromFgLines,
  buildWarrantyMasterFgDetailIndex,
  exportWarrantyMasterCsv,
  filterWarrantyMasterFgLines,
  sortWarrantyMonthValues,
  summarizeWarrantyMasterRows,
  type WarrantyMasterAggregateRow,
  type WarrantyMasterClientFilters,
  type WarrantyMasterFgLineRow,
} from '@/lib/warranty-master';
import {
  clearWarrantyMasterCache,
  readWarrantyMasterCache,
  writeWarrantyMasterCache,
} from '@/lib/warranty-master/client-cache';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { PageAlert } from '@/components/ui/PageAlert';
import { feedback } from '@/lib/ui/feedback';
import { triggerBlobDownload } from '@/lib/report/summary-excel-export';
import { usePageAlert } from '@/hooks/usePageAlert';
import { DataTableLoading } from '@/components/ui/DataTableLoading';

const EMPTY_FILTERS: WarrantyMasterClientFilters = {
  selectedCustomer: [],
  selectedGroup: [],
  selectedFgModel: [],
  selectedWarrantyMonths: [],
  warrEndFrom: '',
  warrEndTo: '',
  activeOnly: false,
};

function cloneFilters(filters: WarrantyMasterClientFilters): WarrantyMasterClientFilters {
  return {
    selectedCustomer: [...filters.selectedCustomer],
    selectedGroup: [...filters.selectedGroup],
    selectedFgModel: [...filters.selectedFgModel],
    selectedWarrantyMonths: [...filters.selectedWarrantyMonths],
    warrEndFrom: filters.warrEndFrom,
    warrEndTo: filters.warrEndTo,
    activeOnly: filters.activeOnly,
  };
}

function isEmptyFilters(filters: WarrantyMasterClientFilters): boolean {
  return (
    filters.selectedCustomer.length === 0 &&
    filters.selectedGroup.length === 0 &&
    filters.selectedFgModel.length === 0 &&
    filters.selectedWarrantyMonths.length === 0 &&
    !filters.warrEndFrom.trim() &&
    !filters.warrEndTo.trim() &&
    !filters.activeOnly
  );
}

type ActiveChip = { id: string; label: string; onRemove: () => void };

function formatCacheLabel(cachedAt: string): string {
  try {
    const d = new Date(cachedAt);
    if (Number.isNaN(d.getTime())) return 'cached';
    return `cached ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  } catch {
    return 'cached';
  }
}

function sortDimOptions(options: { value: string; label: string }[]) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...options].sort((a, b) =>
    collator.compare(a.label || a.value, b.label || b.value)
  );
}

export default function WarrantyMasterPage() {
  const supabase = createClient();
  const [filters, setFilters] = useState<WarrantyMasterClientFilters>(() => cloneFilters(EMPTY_FILTERS));
  const deferredFilters = useDeferredValue(filters);
  const [allFgLines, setAllFgLines] = useState<WarrantyMasterFgLineRow[]>(() => {
    return readWarrantyMasterCache()?.fgLines ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [cacheLabel, setCacheLabel] = useState<string | null>(() => {
    const cached = readWarrantyMasterCache();
    return cached ? formatCacheLabel(cached.cachedAt) : null;
  });
  const [exporting, setExporting] = useState(false);
  const { alert: pageAlert, setError: setPageError, clear: clearPageAlert } = usePageAlert();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const isFilterStale = deferredFilters !== filters;

  const dims = useMemo(() => buildWarrantyMasterDimsFromFgLines(allFgLines), [allFgLines]);

  const catalogMachineTotal = useMemo(
    () => allFgLines.reduce((sum, line) => sum + line.machineCount, 0),
    [allFgLines]
  );

  const filteredFgLines = useMemo(
    () => filterWarrantyMasterFgLines(allFgLines, deferredFilters),
    [allFgLines, deferredFilters]
  );

  const fgDetailIndex = useMemo(
    () => buildWarrantyMasterFgDetailIndex(filteredFgLines),
    [filteredFgLines]
  );

  const displayRows = useMemo(
    () => aggregateWarrantyMasterFgLines(filteredFgLines, deferredFilters),
    [filteredFgLines, deferredFilters]
  );

  const summary = useMemo(
    () => summarizeWarrantyMasterRows(displayRows),
    [displayRows]
  );

  const updateFilters = useCallback(
    (updater: (prev: WarrantyMasterClientFilters) => WarrantyMasterClientFilters) => {
      startTransition(() => {
        setFilters((prev) => cloneFilters(updater(prev)));
        setExpandedKey(null);
      });
    },
    []
  );

  const fetchMeta = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/report/warranty-master?mode=meta', {
      credentials: 'include',
      signal,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
    }
    return (await res.json()) as { totalMachines: number };
  }, []);

  const fetchAllFgLines = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/report/warranty-master?mode=fgLines', {
      credentials: 'include',
      signal,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
    }
    return (await res.json()) as {
      fgLines: WarrantyMasterFgLineRow[];
      meta?: { totalMachines: number };
    };
  }, []);

  const loadFromDatabase = useCallback(
    async (options?: { force?: boolean }) => {
      const force = options?.force === true;
      abortRef.current?.abort();
      const generation = ++loadGenerationRef.current;
      const abort = new AbortController();
      abortRef.current = abort;
      setExpandedKey(null);
      clearPageAlert();
      const isStale = () => generation !== loadGenerationRef.current;

      const cached = !force ? readWarrantyMasterCache() : null;
      if (cached) {
        setAllFgLines(cached.fgLines);
        setCacheLabel(formatCacheLabel(cached.cachedAt));
      }

      const needsFullFetch = force || !cached;
      if (needsFullFetch) setLoading(true);

      try {
        const meta = await fetchMeta(abort.signal);
        if (isStale() || abort.signal.aborted) return;

        if (!force && cached && cached.totalMachines === meta.totalMachines) {
          return;
        }

        if (!needsFullFetch) setLoading(true);

        const { fgLines, meta: payloadMeta } = await fetchAllFgLines(abort.signal);
        if (isStale() || abort.signal.aborted) return;

        const totalMachines = payloadMeta?.totalMachines ?? meta.totalMachines;
        setAllFgLines(fgLines);
        writeWarrantyMasterCache(totalMachines, fgLines);
        setCacheLabel(formatCacheLabel(new Date().toISOString()));
      } catch (err: unknown) {
        if (isStale() || (err instanceof Error && err.name === 'AbortError')) return;
        setPageError(
          sanitizeUserFacingMessage(
            err instanceof Error ? err.message : 'Failed to load Warranty Master'
          )
        );
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [fetchAllFgLines, fetchMeta, clearPageAlert, setPageError]
  );

  useEffect(() => {
    void loadFromDatabase();
    return () => {
      loadGenerationRef.current += 1;
      abortRef.current?.abort();
    };
  }, [loadFromDatabase]);

  const handleForceRefresh = useCallback(() => {
    clearWarrantyMasterCache();
    void loadFromDatabase({ force: true });
  }, [loadFromDatabase]);

  const customerOptions = useMemo(
    () =>
      sortDimOptions(
        (dims?.customers ?? []).map((c) => ({
          value: c.value,
          label: c.label || c.value,
        }))
      ),
    [dims?.customers]
  );

  const groupOptions = useMemo(
    () =>
      sortDimOptions(
        (dims?.groups ?? []).map((g) => ({
          value: g.value,
          label: g.label || g.value,
        }))
      ),
    [dims?.groups]
  );

  const fgModelOptions = useMemo(
    () =>
      sortDimOptions(
        (dims?.fgModels ?? []).map((f) => ({
          value: f.value,
          label: f.label || f.value,
        }))
      ),
    [dims?.fgModels]
  );

  const warrantyMonthOptions = useMemo(
    () =>
      sortWarrantyMonthValues(dims?.warrantyMonths ?? []).map((m) => ({
        value: String(m),
        label: `${m} mo`,
      })),
    [dims?.warrantyMonths]
  );

  const labelFor = useCallback(
    (options: { value: string; label: string }[], value: string) =>
      options.find((o) => o.value === value)?.label ?? value,
    []
  );

  const handleReset = useCallback(() => {
    startTransition(() => {
      setFilters(cloneFilters(EMPTY_FILTERS));
      setExpandedKey(null);
    });
  }, []);

  const toggleRowExpand = useCallback((row: WarrantyMasterAggregateRow) => {
    const key = aggregateRowKey(row);
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const handleExportCsv = async () => {
    if (displayRows.length === 0) {
      feedback.actionFailed('Nothing to export');
      return;
    }
    setExporting(true);
    try {
      const csv = exportWarrantyMasterCsv(displayRows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const fileName = `warranty-master-${new Date().toISOString().slice(0, 10)}.csv`;
      await triggerBlobDownload(blob, fileName);
      feedback.actionSuccess(`Downloading ${fileName}`);
    } catch (err: unknown) {
      feedback.actionFailed(
        sanitizeUserFacingMessage(err instanceof Error ? err.message : 'Export failed')
      );
    } finally {
      setExporting(false);
    }
  };

  const activeChips = useMemo((): ActiveChip[] => {
    const current = filters;
    const chips: ActiveChip[] = [];
    const patch = (next: Partial<WarrantyMasterClientFilters>) => {
      updateFilters((base) => ({ ...base, ...next }));
    };

    for (const id of current.selectedCustomer) {
      chips.push({
        id: `cust-${id}`,
        label: labelFor(customerOptions, id),
        onRemove: () =>
          patch({
            selectedCustomer: filtersRef.current.selectedCustomer.filter((v) => v !== id),
          }),
      });
    }
    for (const id of current.selectedGroup) {
      chips.push({
        id: `grp-${id}`,
        label: labelFor(groupOptions, id),
        onRemove: () =>
          patch({
            selectedGroup: filtersRef.current.selectedGroup.filter((v) => v !== id),
          }),
      });
    }
    for (const id of current.selectedFgModel) {
      chips.push({
        id: `fg-${id}`,
        label: id,
        onRemove: () =>
          patch({
            selectedFgModel: filtersRef.current.selectedFgModel.filter((v) => v !== id),
          }),
      });
    }
    for (const m of current.selectedWarrantyMonths) {
      chips.push({
        id: `mo-${m}`,
        label: `${m} months`,
        onRemove: () =>
          patch({
            selectedWarrantyMonths: filtersRef.current.selectedWarrantyMonths.filter((v) => v !== m),
          }),
      });
    }
    return chips;
  }, [filters, customerOptions, groupOptions, labelFor, updateFilters]);

  const hasAppliedFilters = !isEmptyFilters(filters);
  const tableLoading = loading && displayRows.length === 0;
  const tableUpdating = loading && displayRows.length > 0;
  const emptyMessage =
    tableLoading
      ? 'Loading warranty data…'
      : hasAppliedFilters
        ? 'No machines match these filters. Try Reset filters or fewer selections.'
        : 'No non-returned machines with parseable warranty dates were found.';

  const pageSubtitle = useMemo(() => {
    const parts = ['Non-returned machines · parseable warranty dates'];
    if (cacheLabel) parts.push(cacheLabel);
    return parts.join(' · ');
  }, [cacheLabel]);

  const showSummaryPanel = allFgLines.length > 0 || loading;

  const toolbar = (
    <WarrantyMasterToolbar
      customerOptions={customerOptions}
      groupOptions={groupOptions}
      fgModelOptions={fgModelOptions}
      warrantyMonthOptions={warrantyMonthOptions}
      filters={filters}
      onCustomerChange={(v) => updateFilters((d) => ({ ...d, selectedCustomer: v }))}
      onGroupChange={(v) => updateFilters((d) => ({ ...d, selectedGroup: v }))}
      onFgModelChange={(v) => updateFilters((d) => ({ ...d, selectedFgModel: v }))}
      onWarrantyMonthsChange={(v) => updateFilters((d) => ({ ...d, selectedWarrantyMonths: v }))}
      onActiveOnlyChange={(value) => updateFilters((d) => ({ ...d, activeOnly: value }))}
      onWarrEndFromChange={(value) => updateFilters((d) => ({ ...d, warrEndFrom: value }))}
      onWarrEndToChange={(value) => updateFilters((d) => ({ ...d, warrEndTo: value }))}
      onResetAll={handleReset}
      isFiltering={hasAppliedFilters}
    />
  );

  const headerActions = (
    <WarrantyMasterHeaderActions
      onRefresh={() => void handleForceRefresh()}
      onExportCsv={() => void handleExportCsv()}
      refreshDisabled={loading}
      exportDisabled={exporting || displayRows.length === 0}
      exporting={exporting}
      cacheLabel={null}
    />
  );

  return (
    <PageShell
      title="Warranty Master"
      subtitle={pageSubtitle}
      icon={<Shield className="h-4 w-4" />}
      actions={headerActions}
      toolbar={toolbar}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-soft"
    >
      <div className="flex shrink-0 flex-col">
        {activeChips.length > 0 ? (
          <div className="register-filter-chips border-b border-slate-200 bg-bg-canvas px-3 py-1.5">
            <AnimatedChipList>
              {activeChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={chip.onRemove}
                  className="register-filter-chip"
                  title={`Remove ${chip.label}`}
                >
                  <span className="truncate">{chip.label}</span>
                  <X size={12} className="shrink-0" />
                </button>
              ))}
            </AnimatedChipList>
            <button
              type="button"
              onClick={handleReset}
              className="register-filter-chip register-filter-chip--clear"
            >
              Clear all
            </button>
          </div>
        ) : null}

        {pageAlert ? (
          <div className="px-3 pt-1">
            <PageAlert
              variant={pageAlert.variant}
              message={pageAlert.message}
              onDismiss={clearPageAlert}
            />
          </div>
        ) : null}

        {showSummaryPanel ? (
          <WarrantyMasterSummaryPanel
            summary={summary}
            catalogMachineTotal={catalogMachineTotal}
            rowCount={displayRows.length}
            isFiltered={hasAppliedFilters}
            isStale={isFilterStale}
          />
        ) : null}
      </div>

      <PageScrollRegion>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="register-table-meta shrink-0">
            <span className="text-[11px] font-medium text-slate-700">
              {displayRows.length.toLocaleString('en-IN')} customer · group · warranty rows
            </span>
            <span className="text-[10px] text-slate-400">Expand a row for FG model split</span>
          </div>
          <AdminTableCard
            isEmpty={!loading && displayRows.length === 0}
            empty={
              <>
                <p className="text-sm font-medium text-slate-600">No data available</p>
                <p className="text-[11px] text-slate-400">{emptyMessage}</p>
              </>
            }
            scrollClassName="min-h-0 flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar"
          >
            <DataTableLoading
              loading={tableLoading}
              updating={tableUpdating || isFilterStale}
              hasContent={displayRows.length > 0}
              loadingLabel="Loading warranty data…"
              updatingLabel="Updating view…"
            >
              <WarrantyMasterTable
                rows={displayRows}
                filters={deferredFilters}
                fgDetailIndex={fgDetailIndex}
                expandedKey={expandedKey}
                onToggleExpand={toggleRowExpand}
              />
            </DataTableLoading>
          </AdminTableCard>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
