import type { MisEmailBodySectionId } from '@/features/mis-email/services/body-sections';

export type MisEmailBodyLayoutMode = 'stacked' | 'grid';

export type MisEmailBodyGridPlacement = {
  sectionId: MisEmailBodySectionId;
  /** 1-based column */
  col: number;
  /** 1-based row */
  row: number;
  colSpan?: number;
  rowSpan?: number;
};

export type MisEmailBodyLayout = {
  mode: MisEmailBodyLayoutMode;
  /** Grid column count (default 2). */
  columns?: number;
  placements?: MisEmailBodyGridPlacement[];
  /** Merge region cells in the key-account table (legacy daily MIS). */
  mergeKeyAccountRegions?: boolean;
};

export const MIS_EMAIL_BODY_LAYOUT_PRESETS = {
  stacked: {
    id: 'stacked',
    label: 'Stacked (default)',
    description: 'Full-width tables one below another — current layout',
    layout: { mode: 'stacked' } satisfies MisEmailBodyLayout,
  },
  legacy_dashboard: {
    id: 'legacy_dashboard',
    label: 'Legacy dashboard',
    description: 'Regional + branch on the left, key accounts on the right with merged regions',
    layout: {
      mode: 'grid',
      columns: 2,
      mergeKeyAccountRegions: true,
      placements: [
        { sectionId: 'regional_performance', col: 1, row: 1 },
        { sectionId: 'branch_performance', col: 1, row: 2 },
        {
          sectionId: 'key_account_performance',
          col: 2,
          row: 1,
          rowSpan: 2,
        },
      ],
    } satisfies MisEmailBodyLayout,
  },
} as const;

export type MisEmailBodyLayoutPresetId = keyof typeof MIS_EMAIL_BODY_LAYOUT_PRESETS;

export const DEFAULT_MIS_EMAIL_BODY_LAYOUT: MisEmailBodyLayout = { mode: 'stacked' };

function isMisEmailBodySectionId(value: unknown): value is MisEmailBodySectionId {
  return (
    value === 'regional_performance' ||
    value === 'branch_performance' ||
    value === 'key_account_performance'
  );
}

export function parseMisEmailBodyLayout(raw: unknown): MisEmailBodyLayout | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;

  const mode = record.mode === 'grid' ? 'grid' : record.mode === 'stacked' ? 'stacked' : null;
  if (!mode) return undefined;

  const layout: MisEmailBodyLayout = { mode };

  if (typeof record.columns === 'number' && record.columns >= 1 && record.columns <= 4) {
    layout.columns = Math.floor(record.columns);
  }
  if (typeof record.mergeKeyAccountRegions === 'boolean') {
    layout.mergeKeyAccountRegions = record.mergeKeyAccountRegions;
  }
  if (Array.isArray(record.placements)) {
    const placements: MisEmailBodyGridPlacement[] = [];
    for (const item of record.placements) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const p = item as Record<string, unknown>;
      if (!isMisEmailBodySectionId(p.sectionId)) continue;
      if (typeof p.col !== 'number' || typeof p.row !== 'number') continue;
      const col = Math.floor(p.col);
      const row = Math.floor(p.row);
      if (col < 1 || row < 1) continue;
      const placement: MisEmailBodyGridPlacement = { sectionId: p.sectionId, col, row };
      if (typeof p.colSpan === 'number' && p.colSpan > 1) {
        placement.colSpan = Math.floor(p.colSpan);
      }
      if (typeof p.rowSpan === 'number' && p.rowSpan > 1) {
        placement.rowSpan = Math.floor(p.rowSpan);
      }
      placements.push(placement);
    }
    if (placements.length > 0) layout.placements = placements;
  }

  return layout;
}

export function resolveMisEmailBodyLayout(layout?: MisEmailBodyLayout | null): MisEmailBodyLayout {
  if (!layout || layout.mode === 'stacked') return DEFAULT_MIS_EMAIL_BODY_LAYOUT;
  return {
    mode: 'grid',
    columns: layout.columns ?? 2,
    placements: layout.placements ?? [],
    mergeKeyAccountRegions: layout.mergeKeyAccountRegions ?? false,
  };
}

export function layoutMatchesPreset(
  layout: MisEmailBodyLayout | undefined,
  presetId: MisEmailBodyLayoutPresetId
): boolean {
  const preset = MIS_EMAIL_BODY_LAYOUT_PRESETS[presetId].layout;
  const resolved = resolveMisEmailBodyLayout(layout);
  const resolvedPreset = resolveMisEmailBodyLayout(preset);
  return JSON.stringify(resolved) === JSON.stringify(resolvedPreset);
}

function normalizePlacements(
  placements: MisEmailBodyGridPlacement[],
  columns: number
): MisEmailBodyGridPlacement[] {
  const seen = new Set<MisEmailBodySectionId>();
  const result: MisEmailBodyGridPlacement[] = [];

  for (const placement of placements) {
    if (seen.has(placement.sectionId)) continue;
    seen.add(placement.sectionId);
    const colSpan = Math.min(placement.colSpan ?? 1, columns);
    result.push({
      ...placement,
      col: Math.max(1, Math.min(placement.col, columns)),
      row: Math.max(1, placement.row),
      colSpan: colSpan > 1 ? colSpan : undefined,
      rowSpan: placement.rowSpan && placement.rowSpan > 1 ? placement.rowSpan : undefined,
    });
  }

  return result;
}

export function filterPlacementsForSections(
  layout: MisEmailBodyLayout,
  sectionIds: MisEmailBodySectionId[]
): MisEmailBodyGridPlacement[] {
  const allowed = new Set(sectionIds);
  return (layout.placements ?? []).filter((p) => allowed.has(p.sectionId));
}

/**
 * Compose section HTML into an email-safe two-column layout (no rowspan — Gmail-safe).
 * Sections in the same column are stacked top-to-bottom.
 */
export function composeEmailBodyGridHtml(
  sectionIds: MisEmailBodySectionId[],
  sectionHtml: Partial<Record<MisEmailBodySectionId, string>>,
  layout: MisEmailBodyLayout
): string {
  const resolved = resolveMisEmailBodyLayout(layout);
  if (resolved.mode === 'stacked') {
    return sectionIds
      .map((id) => sectionHtml[id] ?? '')
      .filter(Boolean)
      .join('');
  }

  const columns = resolved.columns ?? 2;
  const placements = filterPlacementsForSections(resolved, sectionIds);
  const colWidth = Math.floor(100 / columns);

  const byColumn = new Map<number, MisEmailBodyGridPlacement[]>();
  for (const placement of normalizePlacements(placements, columns)) {
    const list = byColumn.get(placement.col) ?? [];
    list.push(placement);
    byColumn.set(placement.col, list);
  }

  const parts: string[] = [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;margin:0 0 20px;">',
    '<tr>',
  ];

  for (let col = 1; col <= columns; col++) {
    const colPlacements = (byColumn.get(col) ?? []).sort((a, b) => a.row - b.row);
    const stackedHtml = colPlacements
      .map((placement) => sectionHtml[placement.sectionId] ?? '')
      .filter(Boolean)
      .map(
        (html) =>
          `<div class="mis-grid-cell" style="overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch;margin:0 0 8px;">${html}</div>`
      )
      .join('');

    parts.push(
      `<td width="${colWidth}%" valign="top" style="width:${colWidth}%;padding:4px 6px;vertical-align:top;">${stackedHtml}</td>`
    );
  }

  parts.push('</tr></table>');

  const placed = new Set(placements.map((p) => p.sectionId));
  const unplaced = sectionIds.filter((id) => sectionHtml[id] && !placed.has(id));
  if (unplaced.length > 0) {
    parts.push(
      unplaced
        .map((id) => sectionHtml[id] ?? '')
        .filter(Boolean)
        .join('')
    );
  }

  return parts.join('');
}

export function defaultGridRowsForSections(sectionIds: MisEmailBodySectionId[]): number {
  return Math.max(2, sectionIds.length);
}
