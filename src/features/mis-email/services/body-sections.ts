import type { BranchSummaryRow, SummaryDashboard } from '@/features/report';
import { MIS_EMAIL_THEME } from '@/features/mis-email/services/email-template';
import type { MisEmailBodyPermissions, MisEmailKeyAccountsByZone } from '@/features/mis-email/services/preferences';
import {
  buildMergedAccountMetricRow,
  DEFAULT_CLIENT_MERGE_WITH_CRM,
  sortAccountRowsByZoneThenAccount,
  type MergeSelection,
} from '@/features/report';
import { clientAccountDisplayName } from '@/features/report';
import {
  composeEmailBodyGridHtml,
  resolveMisEmailBodyLayout,
  type MisEmailBodyLayout,
} from '@/features/mis-email/services/email-body-layout';
import type { BranchPerformanceRow, RegionalPerformanceRow } from '@/features/mis-email/services/mail-types';

export const MIS_EMAIL_BODY_SECTION_IDS = [
  'regional_performance',
  'branch_performance',
  'key_account_performance',
] as const;

export type MisEmailBodySectionId = (typeof MIS_EMAIL_BODY_SECTION_IDS)[number];

export type MisEmailBodySectionDef = {
  id: MisEmailBodySectionId;
  label: string;
  description: string;
  requiresSummary: boolean;
  requiresKeyAccount: boolean;
};

export const MIS_EMAIL_BODY_SECTION_CATALOG: MisEmailBodySectionDef[] = [
  {
    id: 'regional_performance',
    label: 'Regional performance',
    description: 'Zone-wise totals — calls, solved, open, aging, parts, engineers',
    requiresSummary: true,
    requiresKeyAccount: false,
  },
  {
    id: 'branch_performance',
    label: 'Branch-wise performance',
    description: 'Top-level branch rows with the same metrics as the summary report',
    requiresSummary: true,
    requiresKeyAccount: false,
  },
  {
    id: 'key_account_performance',
    label: 'Key account breakdown',
    description: 'Selected key accounts with calls, solved, open, aging, and % >7 days',
    requiresSummary: false,
    requiresKeyAccount: true,
  },
];

export type MisEmailBodyContext = {
  summary: SummaryDashboard;
  /** Pre-built on server (compose-digest); required for regional_performance in email body. */
  regionalPerformanceRows?: RegionalPerformanceRow[];
  /** Pre-built on server from merged trace rows (CRM Cadbury excluded + imports included). */
  branchPerformanceRows?: BranchPerformanceRow[];
  accountRows?: Array<Record<string, unknown>>;
  clientAccountSummary?: Array<Record<string, unknown>>;
  keyAccountsInBody?: string[];
  keyAccountsByZone?: MisEmailKeyAccountsByZone;
};

export type { BranchPerformanceRow, RegionalPerformanceRow } from '@/features/mis-email/services/mail-types';

const DIGEST_MERGE_FLAGS: MergeSelection = { crm: true, client: true };

function sumRegionalRows(rows: RegionalPerformanceRow[]): RegionalPerformanceRow {
  return rows.reduce(
    (acc, row) => ({
      region: 'All',
      total_calls: acc.total_calls + row.total_calls,
      solved_calls: acc.solved_calls + row.solved_calls,
      cancelled_calls: acc.cancelled_calls + row.cancelled_calls,
      open_calls: acc.open_calls + row.open_calls,
      age_2: acc.age_2 + row.age_2,
      age_3: acc.age_3 + row.age_3,
      age_7: acc.age_7 + row.age_7,
      age_15: acc.age_15 + row.age_15,
      part_pending: acc.part_pending + row.part_pending,
      active_eng: acc.active_eng + row.active_eng,
    }),
    {
      region: 'All',
      total_calls: 0,
      solved_calls: 0,
      cancelled_calls: 0,
      open_calls: 0,
      age_2: 0,
      age_3: 0,
      age_7: 0,
      age_15: 0,
      part_pending: 0,
      active_eng: 0,
    }
  );
}

export function buildTopLevelBranchRows(branchSummary: BranchSummaryRow[]): BranchSummaryRow[] {
  return branchSummary.filter(
    (b) => b.parentId === 0 || !branchSummary.some((p) => p.officeId === b.parentId)
  );
}

function formatRegionLabel(region: string): string {
  if (region === 'All') return 'All';
  return region.replace(/\s+ZONE$/i, '');
}

function formatNum(value: number): string {
  return value.toLocaleString('en-IN');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zoneClass(region: string, isGrand = false): string {
  if (isGrand) return 'mis-zone-grand';
  const normalized = (region || '').toUpperCase();
  if (normalized.includes('NORTH')) return 'mis-zone-north';
  if (normalized.includes('EAST')) return 'mis-zone-east';
  if (normalized.includes('WEST')) return 'mis-zone-west';
  if (normalized.includes('SOUTH')) return 'mis-zone-south';
  return 'mis-zone-default';
}

function zoneBgColor(zoneClassName: string): string {
  switch (zoneClassName) {
    case 'mis-zone-north':
      return '#e7f3de';
    case 'mis-zone-east':
      return '#deecf8';
    case 'mis-zone-west':
      return '#fbe8d9';
    case 'mis-zone-south':
      return '#eceef0';
    case 'mis-zone-grand':
      return '#fff8bf';
    default:
      return '#f1f5f9';
  }
}

function age15BandClass(age15: number): string {
  if (age15 < 30) return 'mis-gt15-low';
  if (age15 <= 80) return 'mis-gt15-mid';
  return 'mis-gt15-high';
}

function age15BgColor(age15: number): string {
  if (age15 < 30) return '#bbf7d0';
  if (age15 <= 80) return '#fde68a';
  return '#fecaca';
}

function age15TextColor(): string {
  return '#111827';
}

function solvedTextColor(): string {
  return '#065f46';
}

function pctGt7Class(age7: number, age15: number, openCalls: number): string {
  if (openCalls <= 0) return 'mis-pct-ok';
  const ratio = (age7 + age15) / openCalls;
  return ratio > 0.15 ? 'mis-pct-alert' : 'mis-pct-ok';
}

function pctGt7BgColor(pctClass: string): string | null {
  return pctClass === 'mis-pct-alert' ? '#fee2e2' : null;
}

function pctGt7TextColor(pctClass: string): string {
  return pctClass === 'mis-pct-alert' ? '#991b1b' : '#1e3a8a';
}

function thStyle(theme = MIS_EMAIL_THEME, left = false): string {
  return [
    `padding:6px 8px`,
    `font-family:${theme.fontInline}`,
    `font-size:10px`,
    `font-weight:bold`,
    `line-height:1.3`,
    `color:#ffffff`,
    `background-color:#0070C0`,
    `border:1px solid ${theme.border}`,
    `text-align:${left ? 'left' : 'center'}`,
  ].join(';');
}

function tdStyle(theme = MIS_EMAIL_THEME, opts?: { left?: boolean; bold?: boolean; color?: string; bg?: string }): string {
  const bg = opts?.bg ?? theme.bgCanvas;
  return [
    `padding:6px 8px`,
    `font-family:${theme.fontInline}`,
    `font-size:10px`,
    `line-height:1.35`,
    `color:${opts?.color ?? theme.fgPrimary}`,
    `border:1px solid ${theme.border}`,
    `text-align:${opts?.left ? 'left' : 'center'}`,
    opts?.bold ? 'font-weight:bold' : '',
    `background-color:${bg}`,
  ]
    .filter(Boolean)
    .join(';');
}

function buildPerformanceTableHtml(params: {
  title: string;
  regionColumnLabel: string;
  rows: Array<{
    label: string;
    regionKey: string;
    total_calls: number;
    solved_calls: number;
    cancelled_calls: number;
    open_calls: number;
    age_2: number;
    age_3: number;
    age_7: number;
    age_15: number;
    part_pending: number;
    active_eng: number;
    isGrand?: boolean;
  }>;
}): string {
  const t = MIS_EMAIL_THEME;
  const header = `
    <tr>
      <th class="mis-th mis-th-l" bgcolor="#0070C0" style="${thStyle(t, true)}">${escapeHtml(params.regionColumnLabel)}</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">Total calls</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">Total solved</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}"># open calls</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&lt;2 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;3 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;7 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;15days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}"># of active Eng.</th>
    </tr>`;

  const bodyRows = params.rows
    .map((row) => {
      const rowZoneClass = zoneClass(row.regionKey, row.isGrand);
      const zoneBg = zoneBgColor(rowZoneClass);
      const plainBg = t.bgCanvas;
      const grandBg = zoneBgColor('mis-zone-grand');
      const labelBg = row.isGrand ? grandBg : zoneBg;
      const defaultBg = row.isGrand ? grandBg : plainBg;
      const age15Class = age15BandClass(row.age_15);
      const age15Bg = row.isGrand ? grandBg : age15BgColor(row.age_15);
      const age15Color = age15TextColor();
      const totalCalls = row.solved_calls + row.open_calls;
      return `<tr class="mis-row">
        <td class="mis-td mis-td-l ${rowZoneClass}" bgcolor="${labelBg}" style="${tdStyle(t, { left: true, bold: true, bg: labelBg })}">${escapeHtml(formatRegionLabel(row.label))}</td>
        <td class="mis-td" bgcolor="${defaultBg}" style="${tdStyle(t, { bg: defaultBg })}">${formatNum(totalCalls)}</td>
        <td class="mis-td mis-solved" bgcolor="${defaultBg}" style="${tdStyle(t, { color: solvedTextColor(), bg: defaultBg, bold: true })}">${formatNum(row.solved_calls)}</td>
        <td class="mis-td mis-open" bgcolor="${defaultBg}" style="${tdStyle(t, { bold: true, bg: defaultBg })}">${formatNum(row.open_calls)}</td>
        <td class="mis-td" bgcolor="${defaultBg}" style="${tdStyle(t, { bg: defaultBg })}">${formatNum(row.age_2)}</td>
        <td class="mis-td" bgcolor="${defaultBg}" style="${tdStyle(t, { bg: defaultBg })}">${formatNum(row.age_3)}</td>
        <td class="mis-td" bgcolor="${defaultBg}" style="${tdStyle(t, { bg: defaultBg })}">${formatNum(row.age_7)}</td>
        <td class="mis-td ${age15Class}" bgcolor="${age15Bg}" style="${tdStyle(t, { bg: age15Bg, color: age15Color, bold: true })}">${formatNum(row.age_15)}</td>
        <td class="mis-td" bgcolor="${defaultBg}" style="${tdStyle(t, { bg: defaultBg })}">${formatNum(row.active_eng)}</td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" class="mis-wrap" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td class="mis-title" style="font-family:${t.fontInline};color:${t.fgPrimary};">${escapeHtml(params.title)}</td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" class="mis-inner" width="100%" cellspacing="0" cellpadding="0" border="0">
          <thead>${header}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </td>
    </tr>
  </table>`;
}

function buildKeyAccountTableHtml(
  context: MisEmailBodyContext,
  options?: { mergeRegionCells?: boolean; maxRows?: number }
): string {
  const allRows = sortAccountRowsByZoneThenAccount(context.accountRows ?? []);
  if (!allRows.length) return '';

  const totalRows = allRows.length;
  const maxRows = options?.maxRows;
  const accountRows =
    typeof maxRows === 'number' && maxRows >= 0 && maxRows < totalRows
      ? allRows.slice(0, maxRows)
      : allRows;
  const truncated = accountRows.length < totalRows;

  const t = MIS_EMAIL_THEME;

  const header = `
    <tr>
      <th class="mis-th mis-th-l" bgcolor="#0070C0" style="${thStyle(t, true)}">Region</th>
      <th class="mis-th mis-th-l" bgcolor="#0070C0" style="${thStyle(t, true)}">Key Account</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">Total calls</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">Total solved</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}"># open calls</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&lt;2 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;3 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;7 days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">&gt;15days</th>
      <th class="mis-th" bgcolor="#0070C0" style="${thStyle(t)}">% &gt;7 days</th>
    </tr>`;

  const mergeRegionCells = options?.mergeRegionCells ?? false;
  const mergedRows = accountRows.map((row) =>
    buildMergedAccountMetricRow(
      row,
      context.clientAccountSummary,
      DIGEST_MERGE_FLAGS,
      DEFAULT_CLIENT_MERGE_WITH_CRM
    )
  );

  const bodyRows: string[] = [];
  for (let i = 0; i < mergedRows.length; i++) {
    const merged = mergedRows[i];
    const rowZoneClass = zoneClass(merged.region);
    const zoneBg = zoneBgColor(rowZoneClass);
    const plainBg = t.bgCanvas;
    const pctClass = pctGt7Class(merged.age_7, merged.age_15, merged.open_calls);
    const pctBg = pctGt7BgColor(pctClass);
    const pctCellBg = pctBg ?? plainBg;

    let regionCell = '';
    if (!mergeRegionCells) {
      regionCell = `<td class="mis-td mis-td-l ${rowZoneClass}" bgcolor="${zoneBg}" style="${tdStyle(t, { left: true, bold: true, bg: zoneBg })}">${escapeHtml(formatRegionLabel(merged.region))}</td>`;
    } else {
      const prevRegion = i > 0 ? mergedRows[i - 1].region : null;
      if (merged.region !== prevRegion) {
        let span = 1;
        while (
          i + span < mergedRows.length &&
          mergedRows[i + span].region === merged.region
        ) {
          span++;
        }
        const rowspanAttr = span > 1 ? ` rowspan="${span}"` : '';
        regionCell = `<td class="mis-td mis-td-l ${rowZoneClass}"${rowspanAttr} bgcolor="${zoneBg}" style="${tdStyle(t, { left: true, bold: true, bg: zoneBg })}">${escapeHtml(formatRegionLabel(merged.region))}</td>`;
      }
    }

    bodyRows.push(`<tr class="mis-row">
        ${regionCell}
        <td class="mis-td mis-td-l" bgcolor="${plainBg}" style="${tdStyle(t, { left: true, bold: true, bg: plainBg })}">${escapeHtml(clientAccountDisplayName(merged.account))}</td>
        <td class="mis-td" bgcolor="${plainBg}" style="${tdStyle(t, { bg: plainBg })}">${formatNum(merged.total_solved + merged.open_calls)}</td>
        <td class="mis-td mis-solved" bgcolor="${plainBg}" style="${tdStyle(t, { color: solvedTextColor(), bg: plainBg, bold: true })}">${formatNum(merged.total_solved)}</td>
        <td class="mis-td mis-open" bgcolor="${plainBg}" style="${tdStyle(t, { bold: true, bg: plainBg })}">${formatNum(merged.open_calls)}</td>
        <td class="mis-td" bgcolor="${plainBg}" style="${tdStyle(t, { bg: plainBg })}">${formatNum(merged.age_2)}</td>
        <td class="mis-td" bgcolor="${plainBg}" style="${tdStyle(t, { bg: plainBg })}">${formatNum(merged.age_3)}</td>
        <td class="mis-td" bgcolor="${plainBg}" style="${tdStyle(t, { bg: plainBg })}">${formatNum(merged.age_7)}</td>
        <td class="mis-td" bgcolor="${plainBg}" style="${tdStyle(t, { bg: plainBg })}">${formatNum(merged.age_15)}</td>
        <td class="mis-td mis-pct ${pctClass}" bgcolor="${pctCellBg}" style="${tdStyle(t, { color: pctGt7TextColor(pctClass), bold: true, bg: pctCellBg })}">${escapeHtml(merged.pct_gt_7)}</td>
      </tr>`);
  }

  if (truncated) {
    bodyRows.push(`<tr>
        <td colspan="10" class="mis-note" style="font-family:${t.fontInline};">
          Showing ${accountRows.length} of ${totalRows} key-account rows.
          See the attached Key Account MIS Excel for the full list.
        </td>
      </tr>`);
  }

  return `<table role="presentation" class="mis-wrap" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td class="mis-title" style="font-family:${t.fontInline};color:${t.fgPrimary};">Key Account Breakdown</td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" class="mis-inner" width="100%" cellspacing="0" cellpadding="0" border="0">
          <thead>${header}</thead>
          <tbody>${bodyRows.join('')}</tbody>
        </table>
      </td>
    </tr>
  </table>`;
}

function resolveRegionalPerformanceRows(
  data: SummaryDashboard,
  bodyContext: MisEmailBodyContext
): RegionalPerformanceRow[] {
  // Empty array is valid (scoped user / no rows in range) — do not treat as "missing".
  if (bodyContext.regionalPerformanceRows !== undefined) {
    return bodyContext.regionalPerformanceRows;
  }
  throw new Error(
    'regionalPerformanceRows must be built on the server before rendering MIS email body'
  );
}

function buildRegionalPerformanceHtml(bodyContext: MisEmailBodyContext): string {
  const regionalRows = resolveRegionalPerformanceRows(bodyContext.summary, bodyContext);
  const grand = sumRegionalRows(regionalRows);

  return buildPerformanceTableHtml({
    title: 'Regional Performance',
    regionColumnLabel: 'Region',
    rows: [
      ...regionalRows.map((row) => ({
        label: row.region,
        regionKey: row.region,
        ...row,
      })),
      {
        label: grand.region,
        regionKey: 'ALL',
        ...grand,
        isGrand: true,
      },
    ],
  });
}

function isNonZeroBranchPerformanceRow(row: {
  total_calls: number;
  solved_calls: number;
  cancelled_calls: number;
  open_calls: number;
  age_2: number;
  age_3: number;
  age_7: number;
  age_15: number;
  part_pending: number;
  active_eng: number;
}): boolean {
  // Displayed total is solved+open; hide rows with nothing meaningful to show.
  return (
    Number(row.solved_calls || 0) +
      Number(row.open_calls || 0) +
      Number(row.cancelled_calls || 0) +
      Number(row.age_2 || 0) +
      Number(row.age_3 || 0) +
      Number(row.age_7 || 0) +
      Number(row.age_15 || 0) +
      Number(row.part_pending || 0) +
      Number(row.active_eng || 0) >
    0
  );
}

function resolveBranchPerformanceRows(
  data: SummaryDashboard,
  bodyContext: MisEmailBodyContext
): BranchPerformanceRow[] {
  const rows = bodyContext.branchPerformanceRows?.length
    ? bodyContext.branchPerformanceRows
    : buildTopLevelBranchRows(data.branchSummary)
        .map((row) => ({
          branch: row.branch,
          region: row.region,
          total_calls: row.total_calls,
          solved_calls: row.solved_calls,
          cancelled_calls: row.cancelled_calls,
          open_calls: row.open_calls,
          age_2: row.age_2,
          age_3: row.age_3,
          age_7: row.age_7,
          age_15: row.age_15,
          part_pending: row.part_pending,
          active_eng: row.active_eng,
        }))
        .sort((a, b) => {
          const age15Diff = Number(b.age_15 || 0) - Number(a.age_15 || 0);
          if (age15Diff !== 0) return age15Diff;
          return String(a.branch).localeCompare(String(b.branch));
        });

  return rows.filter(isNonZeroBranchPerformanceRow);
}

function buildBranchPerformanceHtml(data: SummaryDashboard, bodyContext: MisEmailBodyContext): string {
  const branches = resolveBranchPerformanceRows(data, bodyContext);

  return buildPerformanceTableHtml({
    title: 'Branch-wise Performance',
    regionColumnLabel: 'Branches',
    rows: branches.map((row) => ({
      label: row.branch,
      regionKey: row.region,
      total_calls: row.total_calls,
      solved_calls: row.solved_calls,
      cancelled_calls: row.cancelled_calls,
      open_calls: row.open_calls,
      age_2: row.age_2,
      age_3: row.age_3,
      age_7: row.age_7,
      age_15: row.age_15,
      part_pending: row.part_pending,
      active_eng: row.active_eng,
    })),
  });
}

export type MisEmailBodyRenderOptions = {
  layout?: MisEmailBodyLayout | null;
  keyAccountMaxRows?: number;
};

function resolveBodyRenderOptions(
  options?: MisEmailBodyLayout | null | MisEmailBodyRenderOptions
): MisEmailBodyRenderOptions {
  if (!options) return {};
  if ('mode' in options) return { layout: options };
  return options;
}

function buildSectionHtmlMap(
  sectionIds: MisEmailBodySectionId[],
  bodyContext: MisEmailBodyContext,
  renderOptions: MisEmailBodyRenderOptions
): Partial<Record<MisEmailBodySectionId, string>> {
  const data = bodyContext.summary;
  const resolved = resolveMisEmailBodyLayout(renderOptions.layout);
  const mergeRegionCells =
    resolved.mergeKeyAccountRegions === true &&
    resolved.mode === 'grid';
  const map: Partial<Record<MisEmailBodySectionId, string>> = {};

  for (const id of sectionIds) {
    if (id === 'regional_performance') {
      map[id] = buildRegionalPerformanceHtml(bodyContext);
    } else if (id === 'branch_performance') {
      map[id] = buildBranchPerformanceHtml(data, bodyContext);
    } else if (id === 'key_account_performance') {
      const html = buildKeyAccountTableHtml(bodyContext, {
        mergeRegionCells,
        maxRows: renderOptions.keyAccountMaxRows,
      });
      if (html) map[id] = html;
    }
  }

  return map;
}

export function buildEmailBodySectionsHtml(
  sectionIds: MisEmailBodySectionId[],
  context: MisEmailBodyContext | SummaryDashboard,
  options?: MisEmailBodyLayout | null | MisEmailBodyRenderOptions
): string {
  const bodyContext: MisEmailBodyContext =
    'summary' in context ? context : { summary: context };
  const renderOptions = resolveBodyRenderOptions(options);
  const resolvedLayout = resolveMisEmailBodyLayout(renderOptions.layout);
  const sectionHtml = buildSectionHtmlMap(sectionIds, bodyContext, renderOptions);
  return composeEmailBodyGridHtml(sectionIds, sectionHtml, resolvedLayout);
}

export function countKeyAccountBodyRows(context: MisEmailBodyContext): number {
  return sortAccountRowsByZoneThenAccount(context.accountRows ?? []).length;
}

function buildPerformancePlainLines(
  title: string,
  rows: Array<{ label: string } & Omit<RegionalPerformanceRow, 'region'>>
): string[] {
  const lines = [title, ''];
  for (const row of rows) {
    lines.push(
      `${formatRegionLabel(row.label)}: total ${formatNum(row.solved_calls + row.open_calls)}, solved ${formatNum(row.solved_calls)}, open ${formatNum(row.open_calls)}`
    );
  }
  return lines;
}

export function buildEmailBodySectionsPlainText(
  sectionIds: MisEmailBodySectionId[],
  context: MisEmailBodyContext | SummaryDashboard
): string {
  const bodyContext: MisEmailBodyContext =
    'summary' in context ? context : { summary: context };
  const data = bodyContext.summary;
  const blocks: string[] = [];

  if (sectionIds.includes('regional_performance')) {
    const regionalRows = resolveRegionalPerformanceRows(data, bodyContext);
    const grand = sumRegionalRows(regionalRows);
    blocks.push(
      ...buildPerformancePlainLines('Regional Performance', [
        ...regionalRows.map((row) => ({ label: row.region, ...row })),
        { label: grand.region, ...grand },
      ])
    );
  }

  if (sectionIds.includes('branch_performance')) {
    const branches = resolveBranchPerformanceRows(data, bodyContext);
    blocks.push(
      '',
      ...buildPerformancePlainLines(
        'Branch-wise Performance',
        branches.map((row) => ({
          label: row.branch,
          total_calls: row.total_calls,
          solved_calls: row.solved_calls,
          cancelled_calls: row.cancelled_calls,
          open_calls: row.open_calls,
          age_2: row.age_2,
          age_3: row.age_3,
          age_7: row.age_7,
          age_15: row.age_15,
          part_pending: row.part_pending,
          active_eng: row.active_eng,
        }))
      )
    );
  }

  if (sectionIds.includes('key_account_performance') && (bodyContext.accountRows?.length ?? 0) > 0) {
    const accountRows = sortAccountRowsByZoneThenAccount(bodyContext.accountRows ?? []);
    if (accountRows.length > 0) {
      blocks.push('', 'Key Account Breakdown', '');
      for (const row of accountRows) {
        const merged = buildMergedAccountMetricRow(
          row,
          bodyContext.clientAccountSummary,
          DIGEST_MERGE_FLAGS,
          DEFAULT_CLIENT_MERGE_WITH_CRM
        );
        blocks.push(
          `${formatRegionLabel(merged.region)} / ${clientAccountDisplayName(merged.account)}: calls ${formatNum(merged.total_solved + merged.open_calls)}, solved ${formatNum(merged.total_solved)}, open ${formatNum(merged.open_calls)}, % >7 days ${merged.pct_gt_7}`
        );
      }
    }
  }

  return blocks.join('\n').trim();
}

export function parseMisEmailBodySectionIds(raw: unknown): MisEmailBodySectionId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(MIS_EMAIL_BODY_SECTION_IDS);
  const seen = new Set<MisEmailBodySectionId>();
  const result: MisEmailBodySectionId[] = [];

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim() as MisEmailBodySectionId;
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

export function resolveAvailableBodySections(
  permissions: MisEmailBodyPermissions | boolean
): MisEmailBodySectionDef[] {
  const perms: MisEmailBodyPermissions =
    typeof permissions === 'boolean'
      ? { includeSummary: permissions, includeKeyAccount: false }
      : permissions;

  return MIS_EMAIL_BODY_SECTION_CATALOG.filter((section) => {
    if (section.requiresSummary && !perms.includeSummary) return false;
    if (section.requiresKeyAccount && !perms.includeKeyAccount) return false;
    return true;
  });
}

export function resolveEffectiveBodySections(
  permissions: MisEmailBodyPermissions | boolean,
  prefs: { bodyInEmail?: MisEmailBodySectionId[] }
): MisEmailBodySectionId[] {
  const allowed = new Set(resolveAvailableBodySections(permissions).map((s) => s.id));
  return parseMisEmailBodySectionIds(prefs.bodyInEmail).filter((id) => allowed.has(id));
}

/**
 * Body sections for digest send/preview. When key-account attachment is enabled,
 * always include the key-account table in the email body (legacy MIS layout).
 * Users can uncheck "Key account breakdown" in settings and save to opt out.
 */
export function resolveDigestBodySections(
  permissions: MisEmailBodyPermissions,
  prefs: { bodyInEmail?: MisEmailBodySectionId[] },
  options: { includeKeyAccountAttachment: boolean }
): MisEmailBodySectionId[] {
  const sections = resolveEffectiveBodySections(permissions, prefs);

  if (
    options.includeKeyAccountAttachment &&
    permissions.includeKeyAccount &&
    !sections.includes('key_account_performance')
  ) {
    return [...sections, 'key_account_performance'];
  }

  return sections;
}
