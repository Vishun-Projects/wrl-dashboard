'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ChevronDown, ChevronRight, ChevronUp, Download, RefreshCw, Shield, X } from 'lucide-react';
import { PageShell, PageScrollRegion } from '@/components/layout/PageShell';
import { RegisterMultiSelect } from '@/components/register/RegisterMultiSelect';
import {
  AdminStatPill,
  AdminTable,
  AdminTableCard,
  AdminTd,
  AdminTh,
  AdminThead,
  AdminTr,
} from '@/components/admin/AdminUi';
import { WarrantyMasterFgDetailTable } from '@/components/warranty-master/WarrantyMasterFgDetailTable';
import { TruncatedText } from '@/components/ui/TruncatedText';
import {
  aggregateWarrantyMasterFgLines,
  buildWarrantyMasterDimsFromFgLines,
  exportWarrantyMasterCsv,
  fgDetailRowsForAggregate,
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
import { usePageAlert } from '@/hooks/usePageAlert';

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

function aggregateRowKey(row: WarrantyMasterAggregateRow): string {
  return `${row.customerKey || row.customerName}::${row.groupKey || row.groupName}::${row.warrantyMonths}`;
}

function isEmptyDraft(draft: WarrantyMasterClientFilters): boolean {
  return (
    draft.selectedCustomer.length === 0 &&
    draft.selectedGroup.length === 0 &&
    draft.selectedFgModel.length === 0 &&
    draft.selectedWarrantyMonths.length === 0 &&
    !draft.warrEndFrom.trim() &&
    !draft.warrEndTo.trim() &&
    !draft.activeOnly
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

export default function WarrantyMasterPage() {
  const supabase = createClient();
  const [draft, setDraft] = useState<WarrantyMasterClientFilters>(() => cloneFilters(EMPTY_FILTERS));
  const [applied, setApplied] = useState<WarrantyMasterClientFilters>(() => cloneFilters(EMPTY_FILTERS));
  const [allFgLines, setAllFgLines] = useState<WarrantyMasterFgLineRow[]>(() => {
    return readWarrantyMasterCache()?.fgLines ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [cacheLabel, setCacheLabel] = useState<string | null>(() => {
    const cached = readWarrantyMasterCache();
    return cached ? formatCacheLabel(cached.cachedAt) : null;
  });
  const [exporting, setExporting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { alert: pageAlert, setError: setPageError, clear: clearPageAlert } = usePageAlert();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadGenerationRef = useRef(0);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [supabase]);

  const dims = useMemo(() => buildWarrantyMasterDimsFromFgLines(allFgLines), [allFgLines]);

  const filteredFgLines = useMemo(
    () => filterWarrantyMasterFgLines(allFgLines, applied),
    [allFgLines, applied]
  );

  const displayRows = useMemo(
    () => aggregateWarrantyMasterFgLines(filteredFgLines, applied),
    [filteredFgLines, applied]
  );

  const summary = useMemo(
    () => summarizeWarrantyMasterRows(displayRows),
    [displayRows]
  );

  const fetchMeta = useCallback(
    async (signal?: AbortSignal) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/report/warranty-master?mode=meta', { headers, signal });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
      }
      return (await res.json()) as { totalMachines: number };
    },
    [getAuthHeaders]
  );

  const fetchAllFgLines = useCallback(
    async (signal?: AbortSignal) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/report/warranty-master?mode=fgLines', { headers, signal });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(String((errJson as { error?: string }).error ?? res.statusText));
      }
      const json = (await res.json()) as {
        fgLines: WarrantyMasterFgLineRow[];
        meta?: { totalMachines: number };
      };
      return json;
    },
    [getAuthHeaders]
  );

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
        const message = sanitizeUserFacingMessage(
          err instanceof Error ? err.message : 'Failed to load Warranty Master'
        );
        setPageError(message);
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [fetchAllFgLines, fetchMeta, clearPageAlert, setPageError]
  );

  const applyFilters = useCallback((filters: WarrantyMasterClientFilters) => {
    const snapshot = cloneFilters(filters);
    setDraft(snapshot);
    setApplied(snapshot);
    setExpandedKey(null);
  }, []);

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

  const sortDimOptions = (options: { value: string; label: string }[]) =>
    [...options].sort((a, b) =>
      new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare(
        a.label || a.value,
        b.label || b.value
      )
    );

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

  const commitDraft = useCallback(
    (updater: (prev: WarrantyMasterClientFilters) => WarrantyMasterClientFilters) => {
      setDraft((prev) => {
        const next = cloneFilters(updater(prev));
        setApplied(next);
        setExpandedKey(null);
        return next;
      });
    },
    []
  );

  const handleReset = () => {
    setAdvancedOpen(false);
    applyFilters(EMPTY_FILTERS);
  };

  const toggleRowExpand = useCallback((row: WarrantyMasterAggregateRow) => {
    const key = aggregateRowKey(row);
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const handleExportCsv = () => {
    if (displayRows.length === 0) return;
    setExporting(true);
    try {
      const csv = exportWarrantyMasterCsv(displayRows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warranty-master-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      feedback.actionSuccess('CSV downloaded');
    } catch (err: unknown) {
      feedback.actionFailed(
        sanitizeUserFacingMessage(err instanceof Error ? err.message : 'Export failed')
      );
    } finally {
      setExporting(false);
    }
  };

  const activeChips = useMemo((): ActiveChip[] => {
    const current = applied;
    if (!current) return [];
    const chips: ActiveChip[] = [];
    for (const id of current.selectedCustomer) {
      chips.push({
        id: `cust-${id}`,
        label: labelFor(customerOptions, id),
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(
            cloneFilters({
              ...base,
              selectedCustomer: base.selectedCustomer.filter((v) => v !== id),
            })
          );
        },
      });
    }
    for (const id of current.selectedGroup) {
      chips.push({
        id: `grp-${id}`,
        label: labelFor(groupOptions, id),
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(
            cloneFilters({
              ...base,
              selectedGroup: base.selectedGroup.filter((v) => v !== id),
            })
          );
        },
      });
    }
    for (const id of current.selectedFgModel) {
      chips.push({
        id: `fg-${id}`,
        label: id,
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(
            cloneFilters({
              ...base,
              selectedFgModel: base.selectedFgModel.filter((v) => v !== id),
            })
          );
        },
      });
    }
    for (const m of current.selectedWarrantyMonths) {
      chips.push({
        id: `mo-${m}`,
        label: `${m} months`,
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(
            cloneFilters({
              ...base,
              selectedWarrantyMonths: base.selectedWarrantyMonths.filter((v) => v !== m),
            })
          );
        },
      });
    }
    if (current.warrEndFrom || current.warrEndTo) {
      chips.push({
        id: 'warr-end',
        label: `Warranty ends ${current.warrEndFrom || '…'} – ${current.warrEndTo || '…'}`,
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(cloneFilters({ ...base, warrEndFrom: '', warrEndTo: '' }));
        },
      });
    }
    if (current.activeOnly) {
      chips.push({
        id: 'active',
        label: 'Active warranty today',
        onRemove: () => {
          const base = appliedRef.current;
          if (!base) return;
          applyFilters(cloneFilters({ ...base, activeOnly: false }));
        },
      });
    }
    return chips;
  }, [applied, customerOptions, groupOptions, labelFor, applyFilters]);

  const hasAppliedFilters = !isEmptyDraft(applied);
  const emptyMessage =
    loading && allFgLines.length === 0
      ? 'Loading…'
      : hasAppliedFilters
        ? 'No machines match these filters. Try Reset or fewer filters.'
        : 'No non-returned machines with parseable warranty dates were found.';

  return (
    <PageShell
      title="Warranty Master"
      subtitle="Non-returned machines by customer, product group, and warranty length (months)"
      icon={<Shield size={18} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleForceRefresh()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
            {cacheLabel && !loading ? (
              <span className="text-[10px] font-normal text-slate-400">({cacheLabel})</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting || displayRows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      }
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50"
    >
      <PageScrollRegion className="gap-3 p-4">
        <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-xs text-slate-500">
            Filters apply instantly (client-side). Data is cached for this session and only
            re-fetched when the total machine count changes — use{' '}
            <span className="font-medium text-slate-700">Refresh</span> to force a reload.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <RegisterMultiSelect
              label="Customer"
              layout="inline"
              options={customerOptions}
              selected={draft.selectedCustomer}
              onChange={(v) => commitDraft((d) => ({ ...d, selectedCustomer: v }))}
              searchable
              searchPlaceholder="Search…"
              panelClassName="w-72"
            />
            <RegisterMultiSelect
              label="Group"
              layout="inline"
              options={groupOptions}
              selected={draft.selectedGroup}
              onChange={(v) => commitDraft((d) => ({ ...d, selectedGroup: v }))}
              searchable
              panelClassName="w-56"
            />
            <RegisterMultiSelect
              label="FG model"
              layout="inline"
              options={fgModelOptions}
              selected={draft.selectedFgModel}
              onChange={(v) => commitDraft((d) => ({ ...d, selectedFgModel: v }))}
              searchable
              searchPlaceholder="Search…"
              panelClassName="w-56"
            />
            <RegisterMultiSelect
              label="Warranty (months)"
              layout="inline"
              options={warrantyMonthOptions}
              selected={draft.selectedWarrantyMonths}
              onChange={(v) => commitDraft((d) => ({ ...d, selectedWarrantyMonths: v }))}
              panelClassName="w-44"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => commitDraft((d) => ({ ...d, activeOnly: !d.activeOnly }))}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                draft.activeOnly
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              Active warranty today
            </button>

            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Warranty end date
              {(draft.warrEndFrom || draft.warrEndTo) && (
                <span className="ml-1 rounded bg-slate-100 px-1.5 text-[10px] text-slate-700">
                  set
                </span>
              )}
            </button>
          </div>

          {advancedOpen && (
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
              <p className="mb-2 text-[10px] text-slate-500">
                Limit to machines whose warranty <span className="font-medium">end date</span> falls
                in this range (optional).
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  From
                  <input
                    type="date"
                    name="warranty-end-from"
                    autoComplete="off"
                    value={draft.warrEndFrom}
                    onChange={(e) => commitDraft((d) => ({ ...d, warrEndFrom: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600">
                  To
                  <input
                    type="date"
                    name="warranty-end-to"
                    autoComplete="off"
                    value={draft.warrEndTo}
                    onChange={(e) => commitDraft((d) => ({ ...d, warrEndTo: e.target.value }))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  />
                </label>
                {(draft.warrEndFrom || draft.warrEndTo) && (
                  <button
                    type="button"
                    onClick={() => commitDraft((d) => ({ ...d, warrEndFrom: '', warrEndTo: '' }))}
                    className="mb-0.5 text-xs text-slate-500 underline hover:text-slate-800"
                  >
                    Clear dates
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reset all
            </button>
          </div>

          {activeChips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                Applied
              </span>
              {activeChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={chip.onRemove}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-2.5 pr-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-200"
                  title="Remove filter"
                >
                  {chip.label}
                  <X size={12} className="text-slate-400" />
                </button>
              ))}
              <button
                type="button"
                onClick={handleReset}
                className="text-[10px] text-slate-500 underline hover:text-slate-800"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {pageAlert ? (
          <PageAlert
            variant={pageAlert.variant}
            message={pageAlert.message}
            onDismiss={clearPageAlert}
          />
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <AdminStatPill label="Total machines" value={summary.totalMachines.toLocaleString()} />
          <AdminStatPill
            label="Customers"
            value={summary.distinctCustomers.toLocaleString()}
          />
          <AdminStatPill label="Groups" value={summary.distinctGroups.toLocaleString()} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          <p className="shrink-0 text-[10px] text-slate-500">
            Only machines with parseable warranty start/end dates are listed. Click a row for FG
            model breakdown.
          </p>
          <div className="flex min-h-0 flex-1 flex-col">
            <AdminTableCard
              isEmpty={!loading && displayRows.length === 0}
              scrollClassName="min-h-0 flex-1 overflow-x-hidden overflow-y-auto custom-scrollbar"
            >
              <AdminTable className="warranty-master-table w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-8" />
                  <col className="w-[34%]" />
                  <col className="w-[26%]" />
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <AdminThead>
                  <tr>
                    <AdminTh className="w-8">
                      <span className="sr-only">Expand</span>
                    </AdminTh>
                    <AdminTh>Customer</AdminTh>
                    <AdminTh>Group</AdminTh>
                    <AdminTh>Warranty period (in Months)</AdminTh>
                    <AdminTh className="text-left">Count of M/c</AdminTh>
                  </tr>
                </AdminThead>
                <tbody>
                  {loading && displayRows.length === 0 ? (
                      <AdminTr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                          Loading…
                        </td>
                      </AdminTr>
                    ) : displayRows.length === 0 ? (
                      <AdminTr>
                        <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                          {emptyMessage}
                        </td>
                      </AdminTr>
                    ) : (
                      displayRows.map((row, idx) => {
                        const key = aggregateRowKey(row);
                        const isExpanded = expandedKey === key;
                        const detailRows = fgDetailRowsForAggregate(filteredFgLines, row, applied);
                        return (
                          <React.Fragment key={`${key}-${idx}`}>
                            <AdminTr
                              className={`cursor-pointer ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/80'}`}
                              onClick={() => void toggleRowExpand(row)}
                            >
                              <AdminTd className="w-8 text-slate-400">
                                {isExpanded ? (
                                  <ChevronDown size={14} />
                                ) : (
                                  <ChevronRight size={14} />
                                )}
                              </AdminTd>
                              <AdminTd className="max-w-[14rem]">
                                <TruncatedText text={row.customerName} />
                              </AdminTd>
                              <AdminTd>{row.groupName}</AdminTd>
                              <AdminTd>{row.warrantyMonths}</AdminTd>
                              <AdminTd className="text-left tabular-nums font-medium">
                                {row.machineCount.toLocaleString()}
                              </AdminTd>
                            </AdminTr>
                            {isExpanded && (
                              <AdminTr className="border-b border-slate-100 bg-slate-50/60">
                                <td colSpan={5} className="warranty-master-expanded-cell">
                                  <WarrantyMasterFgDetailTable
                                    rows={detailRows ?? []}
                                    parentMachineCount={row.machineCount}
                                    customerName={row.customerName}
                                    groupName={row.groupName}
                                    warrantyMonths={row.warrantyMonths}
                                    loading={false}
                                  />
                                </td>
                              </AdminTr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                </tbody>
              </AdminTable>
            </AdminTableCard>
          </div>
        </div>
      </PageScrollRegion>
    </PageShell>
  );
}
