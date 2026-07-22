'use client';

import React, { useMemo, useState } from 'react';
import { LayoutGrid, Rows3, X } from 'lucide-react';
import type { MisEmailBodySectionDef, MisEmailBodySectionId } from '@/features/mis-email/lib/body-sections';
import {
  MIS_EMAIL_BODY_LAYOUT_PRESETS,
  defaultGridRowsForSections,
  filterPlacementsForSections,
  resolveMisEmailBodyLayout,
  type MisEmailBodyGridPlacement,
  type MisEmailBodyLayout,
  type MisEmailBodyLayoutPresetId,
} from '@/features/mis-email/lib/email-body-layout';

const SECTION_SHORT_LABEL: Record<MisEmailBodySectionId, string> = {
  regional_performance: 'Regional',
  branch_performance: 'Branch',
  key_account_performance: 'Key accounts',
};

type Props = {
  selectedSectionIds: MisEmailBodySectionId[];
  bodySections: MisEmailBodySectionDef[];
  layout: MisEmailBodyLayout | undefined;
  onLayoutChange: (layout: MisEmailBodyLayout) => void;
};

function sectionLabel(
  id: MisEmailBodySectionId,
  bodySections: MisEmailBodySectionDef[]
): string {
  return bodySections.find((s) => s.id === id)?.label ?? SECTION_SHORT_LABEL[id];
}

function placementAt(
  placements: MisEmailBodyGridPlacement[],
  row: number,
  col: number
): MisEmailBodyGridPlacement | undefined {
  return placements.find((p) => {
    const colSpan = p.colSpan ?? 1;
    const rowSpan = p.rowSpan ?? 1;
    return (
      row >= p.row &&
      row < p.row + rowSpan &&
      col >= p.col &&
      col < p.col + colSpan
    );
  });
}

function isCellOrigin(
  placement: MisEmailBodyGridPlacement,
  row: number,
  col: number
): boolean {
  return placement.row === row && placement.col === col;
}

export function MisEmailBodyLayoutEditor({
  selectedSectionIds,
  bodySections,
  layout,
  onLayoutChange,
}: Props) {
  const resolved = resolveMisEmailBodyLayout(layout);
  const isGrid = resolved.mode === 'grid';
  const columns = resolved.columns ?? 2;
  const placements = filterPlacementsForSections(resolved, selectedSectionIds);
  const [pickSection, setPickSection] = useState<MisEmailBodySectionId | null>(null);

  const gridRows = useMemo(() => {
    const fromPlacements = placements.reduce(
      (max, p) => Math.max(max, p.row + (p.rowSpan ?? 1) - 1),
      0
    );
    return Math.max(defaultGridRowsForSections(selectedSectionIds), fromPlacements, 2);
  }, [placements, selectedSectionIds]);

  function applyPreset(presetId: MisEmailBodyLayoutPresetId) {
    const preset = MIS_EMAIL_BODY_LAYOUT_PRESETS[presetId].layout;
    onLayoutChange(preset);
    setPickSection(null);
  }

  function switchToGrid() {
    if (isGrid) return;
    const preset = MIS_EMAIL_BODY_LAYOUT_PRESETS.legacy_dashboard.layout;
    const filtered: MisEmailBodyLayout = {
      ...preset,
      placements: (preset.placements ?? []).filter((p) =>
        selectedSectionIds.includes(p.sectionId)
      ),
    };
    onLayoutChange(filtered.placements?.length ? filtered : { mode: 'grid', columns: 2, placements: [] });
  }

  function switchToStacked() {
    onLayoutChange({ mode: 'stacked' });
    setPickSection(null);
  }

  function updatePlacements(nextPlacements: MisEmailBodyGridPlacement[]) {
    onLayoutChange({
      mode: 'grid',
      columns,
      placements: nextPlacements,
      mergeKeyAccountRegions: resolved.mergeKeyAccountRegions,
    });
  }

  function placeSection(row: number, col: number, sectionId: MisEmailBodySectionId) {
    const without = placements.filter((p) => p.sectionId !== sectionId);
    updatePlacements([...without, { sectionId, row, col }]);
    setPickSection(null);
  }

  function clearCell(row: number, col: number) {
    const target = placementAt(placements, row, col);
    if (!target) return;
    updatePlacements(placements.filter((p) => p.sectionId !== target.sectionId));
  }

  function handleCellClick(row: number, col: number) {
    const existing = placementAt(placements, row, col);
    if (existing && isCellOrigin(existing, row, col)) {
      clearCell(row, col);
      return;
    }
    if (pickSection && selectedSectionIds.includes(pickSection)) {
      placeSection(row, col, pickSection);
    }
  }

  function toggleMergeRegions(checked: boolean) {
    onLayoutChange({
      ...resolved,
      mergeKeyAccountRegions: checked,
    });
  }

  if (selectedSectionIds.length === 0) {
    return (
      <p className="text-[10px] text-slate-500">
        Enable at least one body section above to configure layout.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-relaxed text-slate-500">
        Choose how tables appear in the email. Stacked keeps the current full-width layout.
        Grid lets you place sections side by side — like the legacy daily MIS dashboard.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={switchToStacked}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
            !isGrid
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-600 hover:border-slate-300'
          }`}
        >
          <Rows3 size={12} />
          Stacked
        </button>
        <button
          type="button"
          onClick={switchToGrid}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
            isGrid
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-600 hover:border-slate-300'
          }`}
        >
          <LayoutGrid size={12} />
          Custom grid
        </button>
        {(
          Object.keys(MIS_EMAIL_BODY_LAYOUT_PRESETS) as MisEmailBodyLayoutPresetId[]
        ).map((presetId) => (
          <button
            key={presetId}
            type="button"
            onClick={() => applyPreset(presetId)}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-600 transition-colors hover:border-slate-300 hover:bg-white"
            title={MIS_EMAIL_BODY_LAYOUT_PRESETS[presetId].description}
          >
            {MIS_EMAIL_BODY_LAYOUT_PRESETS[presetId].label}
          </button>
        ))}
      </div>

      {isGrid ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <span className="w-full text-[10px] font-medium text-slate-500">
              {pickSection
                ? `Click a cell to place “${sectionLabel(pickSection, bodySections)}”`
                : 'Pick a section, then click a grid cell'}
            </span>
            {selectedSectionIds.map((id) => {
              const placed = placements.some((p) => p.sectionId === id);
              const active = pickSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPickSection(active ? null : id)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                    active
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : placed
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {SECTION_SHORT_LABEL[id]}
                </button>
              );
            })}
          </div>

          <div
            className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, minmax(72px, auto))`,
            }}
          >
            {Array.from({ length: gridRows }, (_, rowIndex) => {
              const row = rowIndex + 1;
              return Array.from({ length: columns }, (_, colIndex) => {
                const col = colIndex + 1;
                const placement = placementAt(placements, row, col);
                if (placement && !isCellOrigin(placement, row, col)) {
                  return null;
                }

                const colSpan = placement?.colSpan ?? 1;
                const rowSpan = placement?.rowSpan ?? 1;

                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    onClick={() => handleCellClick(row, col)}
                    className={`relative flex min-h-[72px] flex-col items-center justify-center rounded-md border border-dashed p-2 text-center transition-colors ${
                      placement
                        ? 'border-indigo-300 bg-indigo-50/80 hover:bg-indigo-100/80'
                        : pickSection
                          ? 'border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50/50'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                    }`}
                    style={{
                      gridColumn: colSpan > 1 ? `span ${colSpan}` : undefined,
                      gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
                    }}
                  >
                    {placement ? (
                      <>
                        <span className="text-[11px] font-medium text-indigo-900">
                          {sectionLabel(placement.sectionId, bodySections)}
                        </span>
                        {(placement.rowSpan ?? 1) > 1 || (placement.colSpan ?? 1) > 1 ? (
                          <span className="mt-0.5 text-[9px] text-indigo-600">
                            {(placement.colSpan ?? 1) > 1 ? `${placement.colSpan} cols` : ''}
                            {(placement.rowSpan ?? 1) > 1
                              ? `${(placement.colSpan ?? 1) > 1 ? ' · ' : ''}${placement.rowSpan} rows`
                              : ''}
                          </span>
                        ) : null}
                        <span
                          className="absolute right-1 top-1 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearCell(row, col);
                          }}
                          aria-label="Clear cell"
                        >
                          <X size={10} />
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-400">Empty</span>
                    )}
                  </button>
                );
              });
            })}
          </div>

          {selectedSectionIds.includes('key_account_performance') ? (
            <label className="flex items-start gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={resolved.mergeKeyAccountRegions === true}
                onChange={(e) => toggleMergeRegions(e.target.checked)}
              />
              <span>
                Merge region cells in key-account table
                <span className="block text-[10px] text-slate-500">
                  Matches legacy daily MIS — one region label spanning its accounts
                </span>
              </span>
            </label>
          ) : null}
        </>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] text-slate-600">
          Sections appear full width in the order shown above (use ↑↓ to reorder).
        </p>
      )}
    </div>
  );
}
