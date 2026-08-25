'use client';

import React, { useState } from 'react';
import {
  X,
  Sliders,
  CheckCircle2,
  Ban,
  RotateCcw,
  Sparkles,
  Info,
} from 'lucide-react';
import type { AthenaBreakdownItem } from '../types';

interface AthenaReasonRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableReasons: AthenaBreakdownItem[];
  treatAsRegisteredReasons: string[];
  excludedReasons: string[];
  onApplyRules: (params: {
    treatAsRegisteredReasons: string[];
    excludedReasons: string[];
  }) => void;
}

export function AthenaReasonRulesModal({
  isOpen,
  onClose,
  availableReasons,
  treatAsRegisteredReasons: initialTreat,
  excludedReasons: initialExcluded,
  onApplyRules,
}: AthenaReasonRulesModalProps) {
  const [activeTab, setActiveTab] = useState<'treat' | 'exclude'>('treat');
  const [treatReasons, setTreatReasons] = useState<string[]>(initialTreat || []);
  const [excluded, setExcluded] = useState<string[]>(initialExcluded || []);

  if (!isOpen) return null;

  const toggleTreatReason = (reason: string) => {
    setTreatReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
    // If it was in excluded, remove it to prevent collision
    setExcluded((prev) => prev.filter((r) => r !== reason));
  };

  const toggleExcludedReason = (reason: string) => {
    setExcluded((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
    );
    // If it was in treat, remove it to prevent collision
    setTreatReasons((prev) => prev.filter((r) => r !== reason));
  };

  const handleSelectDuplicatesAndOpen = () => {
    const matched = availableReasons
      .map((r) => r.label)
      .filter((label) =>
        /already open|cclid/i.test(label)
      );
    setTreatReasons(Array.from(new Set([...treatReasons, ...matched])));
  };

  const handleClearAll = () => {
    if (activeTab === 'treat') {
      setTreatReasons([]);
    } else {
      setExcluded([]);
    }
  };

  const handleSave = () => {
    onApplyRules({
      treatAsRegisteredReasons: treatReasons,
      excludedReasons: excluded,
    });
    onClose();
  };

  const totalRulesActive = treatReasons.length + excluded.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-blue-100 p-2 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
              <Sliders className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Failure Reason Rules & Exclusions
                </h2>
                {totalRulesActive > 0 && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                    {totalRulesActive} active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Customize how specific Athena error messages are categorized in KPI counts and reports.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-100 bg-slate-50/75 px-5 pt-3 dark:border-slate-800 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={() => setActiveTab('treat')}
            className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-xs font-semibold transition-colors ${
              activeTab === 'treat'
                ? 'border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Treat as Registered / Not a Failure ({treatReasons.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('exclude')}
            className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-xs font-semibold transition-colors ${
              activeTab === 'exclude'
                ? 'border-rose-600 text-rose-700 dark:border-rose-400 dark:text-rose-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Ban className="h-4 w-4" />
            <span>Completely Exclude ({excluded.length})</span>
          </button>
        </div>

        {/* Tab Content Header */}
        <div className="border-b border-slate-100 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-800/20 text-xs">
          {activeTab === 'treat' ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Info className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  Calls with selected reasons are counted under <strong>Subsequently Registered</strong> instead of Active Failures.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectDuplicatesAndOpen}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300"
                >
                  <Sparkles className="h-3 w-3" /> Select Open / CCLID Errors
                </button>
                {treatReasons.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Info className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>
                  Calls with selected reasons will be <strong>completely omitted</strong> from all KPI cards, trends, and table rows.
                </span>
              </div>
              {excluded.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Reasons Checklist */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-100 dark:divide-slate-800 max-h-96">
          {availableReasons.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No failure reasons found for the active filter scope.
            </div>
          ) : (
            availableReasons.map((item) => {
              const isTreated = treatReasons.includes(item.label);
              const isExcluded = excluded.includes(item.label);

              const isChecked = activeTab === 'treat' ? isTreated : isExcluded;

              return (
                <label
                  key={item.label}
                  className={`flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg cursor-pointer transition-colors ${
                    isChecked
                      ? activeTab === 'treat'
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                        : 'bg-rose-50/70 dark:bg-rose-950/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        activeTab === 'treat'
                          ? toggleTreatReason(item.label)
                          : toggleExcludedReason(item.label)
                      }
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                        <span className="truncate">{item.label}</span>
                        {/call is already open/i.test(item.label) && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.2 text-[10px] font-normal text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
                            Wildcard Pattern (all Service Orders)
                          </span>
                        )}
                      </div>
                      {isTreated && activeTab !== 'treat' && (
                        <div className="text-[10px] text-emerald-600 font-medium">
                          Currently marked as: Treat as Registered
                        </div>
                      )}
                      {isExcluded && activeTab !== 'exclude' && (
                        <div className="text-[10px] text-rose-600 font-medium">
                          Currently marked as: Completely Excluded
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0 text-xs">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {item.count.toLocaleString()}
                    </span>
                    <span className="text-[11px] text-slate-400 ml-1">
                      ({item.percentage}%)
                    </span>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 p-4 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => {
              setTreatReasons([]);
              setExcluded([]);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset to Default</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Apply Reason Rules ({totalRulesActive})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
