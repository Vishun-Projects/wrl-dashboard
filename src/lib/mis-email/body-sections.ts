import { getRegionColor } from '@/lib/report/summary-excel-export';
import type { BranchSummaryRow, SummaryDashboard } from '@/lib/report/summary-derive';
import { MIS_EMAIL_THEME } from '@/lib/mis-email/email-template';

export const MIS_EMAIL_BODY_SECTION_IDS = [
  'regional_performance',
  'branch_performance',
] as const;

export type MisEmailBodySectionId = (typeof MIS_EMAIL_BODY_SECTION_IDS)[number];

export type MisEmailBodySectionDef = {
  id: MisEmailBodySectionId;
  label: string;
  description: string;
  requiresSummary: boolean;
};

export const MIS_EMAIL_BODY_SECTION_CATALOG: MisEmailBodySectionDef[] = [
  {
    id: 'regional_performance',
    label: 'Regional performance',
    description: 'Zone-wise totals — calls, solved, open, aging, parts, engineers',
    requiresSummary: true,
  },
  {
    id: 'branch_performance',
    label: 'Branch-wise performance',
    description: 'Top-level branch rows with the same metrics as the summary report',
    requiresSummary: true,
  },
];

export type RegionalPerformanceRow = {
  region: string;
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
};

function sumField(rows: BranchSummaryRow[], key: keyof BranchSummaryRow): number {
  return rows.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);
}

function aggregateRegionalPerformanceRows(branchSummary: BranchSummaryRow[]): RegionalPerformanceRow[] {
  const regions = Array.from(new Set(branchSummary.map((b) => b.region))).sort();
  return regions.map((region) => {
    const rows = branchSummary.filter((b) => b.region === region);
    return {
      region,
      total_calls: sumField(rows, 'total_calls'),
      solved_calls: sumField(rows, 'solved_calls'),
      cancelled_calls: sumField(rows, 'cancelled_calls'),
      open_calls: sumField(rows, 'open_calls'),
      age_2: sumField(rows, 'age_2'),
      age_3: sumField(rows, 'age_3'),
      age_7: sumField(rows, 'age_7'),
      age_15: sumField(rows, 'age_15'),
      part_pending: sumField(rows, 'part_pending'),
      active_eng: sumField(rows, 'active_eng'),
    };
  });
}

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

function regionBgColor(region: string): string {
  return `#${getRegionColor(region)}`.replace(/^#FF/, '#');
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
  const headerStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;font-weight:bold;line-height:1.3;color:#ffffff;background-color:#0070C0;border:1px solid ${t.border};text-align:center;`;
  const cellStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;line-height:1.35;color:${t.fgPrimary};border:1px solid ${t.border};text-align:center;`;
  const labelStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;line-height:1.35;color:${t.fgPrimary};border:1px solid ${t.border};text-align:left;font-weight:bold;`;

  const header = `
    <tr>
      <th style="${headerStyle.replace('text-align:center;', 'text-align:left;')}">${escapeHtml(params.regionColumnLabel)}</th>
      <th style="${headerStyle}">Total calls</th>
      <th style="${headerStyle}">Total solved</th>
      <th style="${headerStyle}">Cancelled</th>
      <th style="${headerStyle}"># open calls</th>
      <th style="${headerStyle}">&lt;2 days</th>
      <th style="${headerStyle}">&gt;3 days</th>
      <th style="${headerStyle}">&gt;7 days</th>
      <th style="${headerStyle}">&gt;15 days</th>
      <th style="${headerStyle}">Part pending</th>
      <th style="${headerStyle}"># of active Eng.</th>
    </tr>`;

  const bodyRows = params.rows
    .map((row) => {
      const bg = row.isGrand ? '#FFFF00' : regionBgColor(row.regionKey);
      const rowStyle = `background-color:${bg};`;
      const solvedStyle = `${cellStyle}color:#059669;`;
      const cancelledStyle = `${cellStyle}color:#DC2626;`;
      const openStyle = `${cellStyle}font-weight:bold;`;

      return `<tr>
        <td style="${labelStyle}${rowStyle}">${escapeHtml(formatRegionLabel(row.label))}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.total_calls + row.cancelled_calls)}</td>
        <td style="${solvedStyle}${rowStyle}">${formatNum(row.solved_calls)}</td>
        <td style="${cancelledStyle}${rowStyle}">${formatNum(row.cancelled_calls)}</td>
        <td style="${openStyle}${rowStyle}">${formatNum(row.open_calls)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.age_2)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.age_3)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.age_7)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.age_15)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.part_pending)}</td>
        <td style="${cellStyle}${rowStyle}">${formatNum(row.active_eng)}</td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-collapse:collapse;width:100%;table-layout:auto;">
    <tr>
      <td style="padding:0 0 8px;font-family:${t.fontInline};font-size:12px;font-weight:bold;line-height:1.4;color:${t.fgPrimary};">${escapeHtml(params.title)}</td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:auto;">
          <thead>${header}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </td>
    </tr>
  </table>`;
}

function buildRegionalPerformanceHtml(data: SummaryDashboard): string {
  const regionalRows = aggregateRegionalPerformanceRows(data.branchSummary);
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

function buildBranchPerformanceHtml(data: SummaryDashboard): string {
  const branches = buildTopLevelBranchRows(data.branchSummary);

  return buildPerformanceTableHtml({
    title: 'Branch-wise Performance',
    regionColumnLabel: 'Branch',
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

export function buildEmailBodySectionsHtml(
  sectionIds: MisEmailBodySectionId[],
  data: SummaryDashboard
): string {
  const blocks: string[] = [];

  for (const id of sectionIds) {
    if (id === 'regional_performance') {
      blocks.push(buildRegionalPerformanceHtml(data));
    } else if (id === 'branch_performance') {
      blocks.push(buildBranchPerformanceHtml(data));
    }
  }

  return blocks.join('');
}

function buildPerformancePlainLines(
  title: string,
  rows: Array<{ label: string } & Omit<RegionalPerformanceRow, 'region'>>
): string[] {
  const lines = [title, ''];
  for (const row of rows) {
    lines.push(
      `${formatRegionLabel(row.label)}: total ${formatNum(row.total_calls + row.cancelled_calls)}, solved ${formatNum(row.solved_calls)}, open ${formatNum(row.open_calls)}, cancelled ${formatNum(row.cancelled_calls)}`
    );
  }
  return lines;
}

export function buildEmailBodySectionsPlainText(
  sectionIds: MisEmailBodySectionId[],
  data: SummaryDashboard
): string {
  const blocks: string[] = [];

  if (sectionIds.includes('regional_performance')) {
    const regionalRows = aggregateRegionalPerformanceRows(data.branchSummary);
    const grand = sumRegionalRows(regionalRows);
    blocks.push(
      ...buildPerformancePlainLines('Regional Performance', [
        ...regionalRows.map((row) => ({ label: row.region, ...row })),
        { label: grand.region, ...grand },
      ])
    );
  }

  if (sectionIds.includes('branch_performance')) {
    const branches = buildTopLevelBranchRows(data.branchSummary);
    blocks.push(
      '',
      ...buildPerformancePlainLines(
        'Branch-wise Performance',
        branches.map((row) => ({
          label: row.branch,
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
      )
    );
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

export function resolveAvailableBodySections(includeSummary: boolean): MisEmailBodySectionDef[] {
  if (!includeSummary) return [];
  return MIS_EMAIL_BODY_SECTION_CATALOG.filter((section) => !section.requiresSummary || includeSummary);
}

export function resolveEffectiveBodySections(
  includeSummary: boolean,
  prefs: { bodyInEmail?: MisEmailBodySectionId[] }
): MisEmailBodySectionId[] {
  if (!includeSummary) return [];
  const allowed = new Set(resolveAvailableBodySections(includeSummary).map((s) => s.id));
  return parseMisEmailBodySectionIds(prefs.bodyInEmail).filter((id) => allowed.has(id));
}
