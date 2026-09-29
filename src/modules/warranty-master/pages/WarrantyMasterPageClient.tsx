'use client';

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';

import { Shield, X } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { WarrantyMasterToolbar } from '@/modules/warranty-master/components/WarrantyMasterToolbar';
import { WarrantyMasterHeaderActions } from '@/modules/warranty-master/components/WarrantyMasterHeaderActions';
import { WarrantyMasterSummaryPanel } from '@/modules/warranty-master/components/WarrantyMasterSummaryPanel';
import { WarrantyMasterHierarchyTable } from '@/modules/warranty-master/components/WarrantyMasterHierarchyTable';
import { WarrantyMasterSerialTable } from '@/modules/warranty-master/components/WarrantyMasterSerialTable';
import { WarrantyMasterImportModal } from '@/modules/warranty-master/components/WarrantyMasterImportModal';
import { AdminTableCard } from '@/components/admin/AdminUi';
import { AnimatedChipList } from '@/components/motion';
import {
  sortWarrantyMonthValues,
  type WarrantyMasterClientFilters,
  type WarrantyMasterHierarchySubgroup,
  type WarrantyMasterSerialRow,
  type WarrantyMasterSummary,
} from '@/modules/warranty-master/services';
import { clearWarrantyMasterCache } from '@/modules/warranty-master/services/client-cache';
import { sanitizeUserFacingMessage } from '@/lib/utils/user-facing-errors';
import { PageAlert } from '@/components/ui/PageAlert';
import { feedback } from '@/lib/ui/feedback';
import { triggerBlobDownload } from '@/modules/mis/download';
import { logClientExportAction } from '@/lib/security/client-export-audit';
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
  serialSearch: '',
};

const EMPTY_SUMMARY: WarrantyMasterSummary = {
  totalMachines: 0,
  distinctCustomers: 0,
  distinctGroups: 0,
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
    serialSearch: filters.serialSearch,
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
    !filters.activeOnly &&
    !filters.serialSearch.trim()
  );
}

type ActiveChip = { id: string; label: string; onRemove: () => void };

function sortDimOptions(options: { value: string; label: string }[]) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...options].sort((a, b) =>
    collator.compare(a.label || a.value, b.label || b.value)
  );
}

function appendFilterParams(params: URLSearchParams, filters: WarrantyMasterClientFilters) {
  if (filters.selectedCustomer.length > 0) {
    params.set('customer', filters.selectedCustomer.join(','));
  }
  if (filters.selectedGroup.length > 0) {
    params.set('group', filters.selectedGroup.join(','));
  }
  if (filters.selectedFgModel.length > 0) {
    params.set('fgModel', filters.selectedFgModel.join(','));
  }
  if (filters.selectedWarrantyMonths.length > 0) {
    params.set('warrantyMonths', filters.selectedWarrantyMonths.join(','));
  }
  if (filters.activeOnly) params.set('activeOnly', '1');
  if (filters.warrEndFrom.trim()) params.set('warrEndFrom', filters.warrEndFrom.trim());
  if (filters.warrEndTo.trim()) params.set('warrEndTo', filters.warrEndTo.trim());
}

export default function WarrantyMasterPage() {
  const [filters, setFilters] = useState<WarrantyMasterClientFilters>(() => cloneFilters(EMPTY_FILTERS));
  const deferredFilters = useDeferredValue(filters);
  const [summary, setSummary] = useState<WarrantyMasterSummary>(EMPTY_SUMMARY);
  const [catalogMachineTotal, setCatalogMachineTotal] = useState(0);
  const [tableRows, setTableRows] = useState(0);
  const [hierarchyRows, setHierarchyRows] = useState<WarrantyMasterHierarchySubgroup[]>([]);
  const [hierarchyTotal, setHierarchyTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingHierarchy, setLoadingHierarchy] = useState(true);
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);
  const [groupOptions, setGroupOptions] = useState<{ value: string; label: string }[]>([]);
  const [fgModelOptions, setFgModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [warrantyMonthOptions, setWarrantyMonthOptions] = useState<{ value: string; label: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  const { alert: pageAlert, setError: setPageError, clear: clearPageAlert } = usePageAlert();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [serialResults, setSerialResults] = useState<WarrantyMasterSerialRow[]>([]);
  const [serialLoading, setSerialLoading] = useState(false);
  const [serialTotal, setSerialTotal] = useState(0);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const hierarchyAbortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const isFilterStale = deferredFilters !== filters;
  const hasSerialSearch = deferredFilters.serialSearch.trim().length > 0;
  const loading = loadingSummary || loadingHierarchy;

  const updateFilters = useCallback(
    (updater: (prev: WarrantyMasterClientFilters) => WarrantyMasterClientFilters) => {
      startTransition(() => {
        setFilters((prev) => cloneFilters(updater(prev)));
        setPage(1);
      });
    },
    []
  );

  const fetchOptions = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/report/warranty-master?mode=options', {
      credentials: 'include',
      signal,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
    }
    const data = (await res.json()) as {
      customers: { value: string; label: string }[];
      groups: { value: string; label: string }[];
      fgModels: { value: string; label: string }[];
      warrantyMonths: number[];
    };
    setCustomerOptions(sortDimOptions(data.customers ?? []));
    setGroupOptions(sortDimOptions(data.groups ?? []));
    setFgModelOptions(sortDimOptions(data.fgModels ?? []));
    setWarrantyMonthOptions(
      sortWarrantyMonthValues(data.warrantyMonths ?? []).map((m) => ({
        value: String(m),
        label: `${m} mo`,
      }))
    );
  }, []);

  const fetchSummary = useCallback(async (filterState: WarrantyMasterClientFilters) => {
    summaryAbortRef.current?.abort();
    const abort = new AbortController();
    summaryAbortRef.current = abort;
    setLoadingSummary(true);
    try {
      const params = new URLSearchParams({ mode: 'summary' });
      appendFilterParams(params, filterState);
      const res = await fetch(`/api/report/warranty-master?${params}`, {
        credentials: 'include',
        signal: abort.signal,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
      }
      const data = (await res.json()) as WarrantyMasterSummary & {
        tableRows?: number;
        catalogMachineTotal?: number;
      };
      setSummary({
        totalMachines: data.totalMachines ?? 0,
        distinctCustomers: data.distinctCustomers ?? 0,
        distinctGroups: data.distinctGroups ?? 0,
      });
      setTableRows(data.tableRows ?? data.distinctCustomers ?? 0);
      setCatalogMachineTotal(data.catalogMachineTotal ?? data.totalMachines ?? 0);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setPageError(
        sanitizeUserFacingMessage(
          err instanceof Error ? err.message : 'Failed to load Warranty Master summary'
        )
      );
    } finally {
      if (!abort.signal.aborted) setLoadingSummary(false);
    }
  }, [setPageError]);

  const fetchHierarchy = useCallback(
    async (
      filterState: WarrantyMasterClientFilters,
      pageNum: number,
      size: number,
      dir: 'asc' | 'desc'
    ) => {
      hierarchyAbortRef.current?.abort();
      const abort = new AbortController();
      hierarchyAbortRef.current = abort;
      setLoadingHierarchy(true);
      clearPageAlert();
      try {
        const params = new URLSearchParams({
          mode: 'hierarchy',
          page: String(pageNum),
          pageSize: String(size),
          sortDir: dir,
        });
        appendFilterParams(params, filterState);
        const res = await fetch(`/api/report/warranty-master?${params}`, {
          credentials: 'include',
          signal: abort.signal,
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
        }
        const data = (await res.json()) as {
          rows: WarrantyMasterHierarchySubgroup[];
          total: number;
          page: number;
          pageSize: number;
        };
        setHierarchyRows(data.rows ?? []);
        setHierarchyTotal(data.total ?? 0);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setPageError(
          sanitizeUserFacingMessage(
            err instanceof Error ? err.message : 'Failed to load Warranty Master'
          )
        );
      } finally {
        if (!abort.signal.aborted) setLoadingHierarchy(false);
      }
    },
    [clearPageAlert, setPageError]
  );

  useEffect(() => {
    const abort = new AbortController();
    void fetchOptions(abort.signal).catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('[warranty-master-options]', err);
    });
    return () => abort.abort();
  }, [fetchOptions]);

  useEffect(() => {
    if (hasSerialSearch) return;
    void fetchSummary(deferredFilters);
    return () => summaryAbortRef.current?.abort();
  }, [deferredFilters, fetchSummary, hasSerialSearch]);

  useEffect(() => {
    if (hasSerialSearch) return;
    void fetchHierarchy(deferredFilters, page, pageSize, sortDir);
    return () => hierarchyAbortRef.current?.abort();
  }, [deferredFilters, fetchHierarchy, hasSerialSearch, page, pageSize, sortDir]);

  useEffect(() => {
    const term = deferredFilters.serialSearch.trim();
    if (!term) {
      setSerialResults([]);
      setSerialTotal(0);
      setSerialLoading(false);
      return;
    }

    const abort = new AbortController();
    setSerialLoading(true);

    const params = new URLSearchParams({
      mode: 'serials',
      serial: term,
      limit: '200',
    });
    appendFilterParams(params, deferredFilters);

    fetch(`/api/report/warranty-master?${params.toString()}`, {
      credentials: 'include',
      signal: abort.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data: { rows?: WarrantyMasterSerialRow[]; serials?: WarrantyMasterSerialRow[]; total?: number }) => {
        const list = data.rows ?? data.serials ?? [];
        setSerialResults(list);
        setSerialTotal(data.total ?? list.length);
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setPageError(
          sanitizeUserFacingMessage(
            err instanceof Error ? err.message : 'Failed to search serial numbers'
          )
        );
      })
      .finally(() => {
        if (!abort.signal.aborted) setSerialLoading(false);
      });

    return () => abort.abort();
  }, [deferredFilters, setPageError]);

  const handleForceRefresh = useCallback(() => {
    clearWarrantyMasterCache();
    void fetchOptions();
    if (!hasSerialSearch) {
      void fetchSummary(filtersRef.current);
      void fetchHierarchy(filtersRef.current, page, pageSize, sortDir);
    }
  }, [fetchHierarchy, fetchOptions, fetchSummary, hasSerialSearch, page, pageSize, sortDir]);

  const labelFor = useCallback(
    (options: { value: string; label: string }[], value: string) =>
      options.find((o) => o.value === value)?.label ?? value,
    []
  );

  const handleReset = useCallback(() => {
    startTransition(() => {
      setFilters(cloneFilters(EMPTY_FILTERS));
      setPage(1);
    });
  }, []);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format: 'csv' });
      if (deferredFilters.serialSearch.trim()) {
        params.set('serialNumber', deferredFilters.serialSearch.trim());
      }
      appendFilterParams(params, deferredFilters);

      const res = await fetch(`/api/report/warranty-master?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
      }

      const blob = await res.blob();
      const fileName = `warranty-master-detailed-${new Date().toISOString().slice(0, 10)}.csv`;
      await triggerBlobDownload(blob, fileName);
      logClientExportAction({
        action: 'report.export.complete',
        reportName: 'warranty_master_detailed',
        format: 'csv',
        filename: fileName,
        summary: 'Exported detailed Warranty Master rows',
      });
      feedback.actionSuccess(`Downloading ${fileName}`);
    } catch (err: unknown) {
      logClientExportAction({
        action: 'report.export.failure',
        reportName: 'warranty_master_detailed',
        format: 'csv',
        summary: 'Detailed Warranty Master export failed',
        metadata: { message: err instanceof Error ? err.message : String(err) },
      });
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
    if (current.serialSearch.trim()) {
      chips.push({
        id: 'serial-search',
        label: `Serial: "${current.serialSearch.trim()}"`,
        onRemove: () => patch({ serialSearch: '' }),
      });
    }
    return chips;
  }, [filters, customerOptions, groupOptions, labelFor, updateFilters]);

  const hasAppliedFilters = !isEmptyFilters(filters);
  const tableLoading = loadingHierarchy && hierarchyRows.length === 0;
  const tableUpdating = loadingHierarchy && hierarchyRows.length > 0;
  const emptyMessage =
    tableLoading
      ? 'Loading warranty data…'
      : hasAppliedFilters
        ? 'No machines match these filters. Try Reset filters or fewer selections.'
        : 'No non-returned machines with parseable warranty dates were found.';

  const showSummaryPanel = !hasSerialSearch && (summary.totalMachines > 0 || loadingSummary || loadingHierarchy);

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
      onSerialSearchChange={(value) => updateFilters((d) => ({ ...d, serialSearch: value }))}
      onResetAll={handleReset}
      isFiltering={hasAppliedFilters}
    />
  );

  const headerActions = (
    <WarrantyMasterHeaderActions
      onRefresh={() => void handleForceRefresh()}
      onExportCsv={() => void handleExportCsv()}
      onImportExcel={() => setImportModalOpen(true)}
      refreshDisabled={loading}
      exportDisabled={exporting || (hasSerialSearch ? serialResults.length === 0 : hierarchyTotal === 0)}
      exporting={exporting}
      cacheLabel={null}
    />
  );

  return (
    <PageShell
      title="Warranty Master"
      subtitle="Non-returned machines · parseable warranty dates"
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
            rowCount={tableRows}
            isFiltered={hasAppliedFilters}
            isStale={isFilterStale || loadingSummary}
          />
        ) : null}
      </div>

      <PageScrollRegion>
        {hasSerialSearch ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="register-table-meta shrink-0">
              <span className="text-[11px] font-medium text-slate-700">
                {serialResults.length.toLocaleString('en-IN')} machine serial{serialResults.length === 1 ? '' : 's'} matching &ldquo;{deferredFilters.serialSearch.trim()}&rdquo;
              </span>
              {serialTotal > serialResults.length && (
                <span className="text-[10px] text-slate-400">
                  (showing first {serialResults.length} of {serialTotal.toLocaleString('en-IN')})
                </span>
              )}
            </div>
            <AdminTableCard
              isEmpty={!serialLoading && serialResults.length === 0}
              empty={
                <>
                  <p className="text-sm font-medium text-slate-600">No serial numbers found</p>
                  <p className="text-[11px] text-slate-400">
                    No machines matched serial number &ldquo;{deferredFilters.serialSearch.trim()}&rdquo;. Check the spelling or clear the serial filter.
                  </p>
                </>
              }
              scrollClassName="min-h-0 flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar"
            >
              <DataTableLoading
                loading={serialLoading && serialResults.length === 0}
                updating={serialLoading && serialResults.length > 0}
                hasContent={serialResults.length > 0}
                loadingLabel="Searching serial numbers…"
                updatingLabel="Updating results…"
              >
                <WarrantyMasterSerialTable rows={serialResults} />
              </DataTableLoading>
            </AdminTableCard>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="register-table-meta shrink-0">
              <span className="text-[11px] font-medium text-slate-700">
                {hierarchyTotal.toLocaleString('en-IN')} customer subgroups
              </span>
              <span className="text-[10px] text-slate-400">Subgroup → group → warranty → serials</span>
            </div>
            <AdminTableCard
              isEmpty={!loadingHierarchy && hierarchyRows.length === 0}
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
                hasContent={hierarchyRows.length > 0}
                loadingLabel="Loading warranty data…"
                updatingLabel="Updating view…"
              >
                <WarrantyMasterHierarchyTable
                  rows={hierarchyRows}
                  total={hierarchyTotal}
                  page={page}
                  pageSize={pageSize}
                  sortDir={sortDir}
                  filters={deferredFilters}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  onSortDirChange={(dir) => {
                    setSortDir(dir);
                    setPage(1);
                  }}
                />
              </DataTableLoading>
            </AdminTableCard>
          </div>
        )}
      </PageScrollRegion>

      <WarrantyMasterImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => void handleForceRefresh()}
      />
    </PageShell>
  );
}
