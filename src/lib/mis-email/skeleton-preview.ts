import {
  resolveDigestBodySections,
  type MisEmailBodySectionId,
} from '@/lib/mis-email/body-sections';
import {
  composeEmailBodyGridHtml,
  resolveMisEmailBodyLayout,
  type MisEmailBodyLayout,
} from '@/lib/mis-email/email-body-layout';
import {
  buildDigestEmailHtml,
  formatReportPeriod,
  MIS_EMAIL_THEME,
} from '@/lib/mis-email/email-template';
import type { DigestDateRange } from '@/lib/mis-email/fetch-digest-data';
import {
  hasAnyEffectiveDigestInclude,
  resolveDigestDateRangeForPreferences,
  resolveEffectiveDigestIncludes,
  resolveMisEmailBodyLayoutFromPrefs,
  type MisEmailBodyPermissions,
  type MisEmailPreferences,
} from '@/lib/mis-email/preferences';

export type MisEmailSkeletonPreview = {
  subject: string;
  scopeLabel: string;
  dateRange: DigestDateRange;
  dateRangeLabel: string;
  attachments: string[];
  html: string;
  bodySectionIds: MisEmailBodySectionId[];
};

function misExportDateLabel(date = new Date()): string {
  return date.toISOString().split('T')[0];
}

function resolveSkeletonAttachmentFilenames(
  includes: ReturnType<typeof resolveEffectiveDigestIncludes>,
  date = new Date()
): string[] {
  const label = misExportDateLabel(date);
  const filenames: string[] = [];
  if (includes.includeSummary) {
    filenames.push(`WRL Summary Dashboard — ${label}.xlsx`);
  }
  if (includes.includeDetailed) {
    filenames.push(`WRL Detailed MIS Register — ${label}.xlsx`);
  }
  if (includes.includeKeyAccount) {
    filenames.push(`WRL Key Account MIS — ${label}.xlsx`);
  }
  if (includes.includeTraceableExport) {
    filenames.push(`WRL_BD_MIS_Traceable_${label}.xlsx`);
  }
  return filenames;
}

function formatDigestSubject(date = new Date()): string {
  return `WRL MIS Reports — ${misExportDateLabel(date)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skeletonBar(widthPercent = 55): string {
  return `<div style="height:9px;width:${widthPercent}%;max-width:48px;background-color:#cbd5e1;border-radius:2px;margin:0 auto;"></div>`;
}

function buildSkeletonPerformanceTable(params: {
  title: string;
  labelColumn: string;
  rowLabels: Array<{ label: string; isGrand?: boolean }>;
  metricColumns: number;
}): string {
  const t = MIS_EMAIL_THEME;
  const headerStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;font-weight:bold;line-height:1.3;color:#ffffff;background-color:#0070C0;border:1px solid ${t.border};text-align:center;`;
  const labelStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;line-height:1.35;color:${t.fgMuted};border:1px solid ${t.border};text-align:left;font-style:italic;`;
  const cellStyle = `padding:8px 6px;font-family:${t.fontInline};font-size:10px;border:1px solid ${t.border};text-align:center;background-color:#f8fafc;`;

  const metricHeaders = [
    'Total calls',
    'Total solved',
    '# open calls',
    '≤2 days',
    '3-7 days',
    '8-15 days',
    '>15 days',
    'Part pending',
    '# of active Eng.',
  ].slice(0, params.metricColumns);

  const header = `
    <tr>
      <th style="${headerStyle.replace('text-align:center;', 'text-align:left;')}">${params.labelColumn}</th>
      ${metricHeaders.map((h) => `<th style="${headerStyle}">${h}</th>`).join('')}
    </tr>`;

  const bodyRows = params.rowLabels
    .map((row, index) => {
      const rowBg = row.isGrand ? '#fffbeb' : '#ffffff';
      const rowStyle = `background-color:${rowBg};`;
      const barWidth = 40 + (index % 3) * 12;
      return `<tr>
        <td style="${labelStyle}${rowStyle}">${row.label}</td>
        ${metricHeaders
          .map((_, col) => {
            const w = barWidth + (col % 2) * 8;
            return `<td style="${cellStyle}${rowStyle}">${skeletonBar(w)}</td>`;
          })
          .join('')}
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-collapse:collapse;width:100%;">
    <tr>
      <td style="padding:0 0 8px;font-family:${t.fontInline};font-size:12px;font-weight:bold;line-height:1.4;color:${t.fgPrimary};">${params.title}</td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
          <thead>${header}</thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </td>
    </tr>
  </table>`;
}

function buildSkeletonKeyAccountTable(
  keyAccountNames: string[],
  mergeRegionCells = false
): string {
  const zones = ['EAST ZONE', 'NORTH ZONE', 'SOUTH ZONE', 'WEST ZONE'];
  const accounts =
    keyAccountNames.length > 0
      ? [...keyAccountNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      : [];

  type SkeletonRow = { zone: string; account: string; isPlaceholder: boolean };
  const labels: SkeletonRow[] =
    accounts.length > 0
      ? zones.flatMap((zone) =>
          accounts.map((name) => ({ zone, account: name, isPlaceholder: false }))
        )
      : [
          { zone: zones[0], account: 'Key account', isPlaceholder: true },
          { zone: zones[1], account: 'Key account', isPlaceholder: true },
          { zone: zones[2], account: 'Key account', isPlaceholder: true },
          { zone: '…', account: '…', isPlaceholder: false },
        ];

  const t = MIS_EMAIL_THEME;
  const headerStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;font-weight:bold;line-height:1.3;color:#ffffff;background-color:#0070C0;border:1px solid ${t.border};text-align:center;`;
  const labelStyle = `padding:6px 8px;font-family:${t.fontInline};font-size:10px;line-height:1.35;color:${t.fgPrimary};border:1px solid ${t.border};text-align:left;font-weight:bold;`;
  const cellStyle = `padding:8px 6px;font-family:${t.fontInline};font-size:10px;border:1px solid ${t.border};text-align:center;background-color:#f8fafc;`;

  const metricCount = 9;
  const header = `
    <tr>
      <th style="${headerStyle.replace('text-align:center;', 'text-align:left;')}">Region</th>
      <th style="${headerStyle.replace('text-align:center;', 'text-align:left;')}">Key Account</th>
      ${['Total calls', 'Total solved', '# open calls', '<2 days', '2-7 days', '7-15 days', '>15 days', '% >7 days', '# of active Eng.']
        .map((h) => `<th style="${headerStyle}">${h}</th>`)
        .join('')}
    </tr>`;

  const bodyRows: string[] = [];
  for (let index = 0; index < labels.length; index++) {
    const row = labels[index];
    if (!row.isPlaceholder && row.zone === '…') {
      bodyRows.push(`<tr>
          <td colspan="${2 + metricCount}" style="padding:8px;font-family:${t.fontInline};font-size:10px;color:${t.fgMuted};text-align:center;border:1px solid ${t.border};background-color:#f8fafc;">All key accounts in scope when none selected</td>
        </tr>`);
      continue;
    }
    const barWidth = 42 + (index % 4) * 10;
    let regionCell = '';
    if (!mergeRegionCells) {
      const zoneLabel = row.isPlaceholder ? skeletonBar(36) : escapeHtml(row.zone.replace(' ZONE', ''));
      regionCell = `<td style="${cellStyle}">${zoneLabel}</td>`;
    } else if (index === 0 || labels[index - 1].zone !== row.zone) {
      let span = 1;
      while (index + span < labels.length && labels[index + span].zone === row.zone) {
        span++;
      }
      const zoneLabel = row.isPlaceholder ? skeletonBar(36) : escapeHtml(row.zone.replace(' ZONE', ''));
      const rowspanAttr = span > 1 ? ` rowspan="${span}"` : '';
      regionCell = `<td style="${cellStyle}"${rowspanAttr}>${zoneLabel}</td>`;
    }
    bodyRows.push(`<tr>
        ${regionCell}
        <td style="${labelStyle}">${row.isPlaceholder ? row.account : escapeHtml(row.account)}</td>
        ${Array.from({ length: metricCount })
          .map((_, col) => `<td style="${cellStyle}">${skeletonBar(barWidth + (col % 2) * 6)}</td>`)
          .join('')}
      </tr>`);
  }

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-collapse:collapse;width:100%;">
    <tr>
      <td style="padding:0 0 8px;font-family:${t.fontInline};font-size:12px;font-weight:bold;line-height:1.4;color:${t.fgPrimary};">Key Account Breakdown</td>
    </tr>
    <tr>
      <td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
          <thead>${header}</thead>
          <tbody>${bodyRows.join('')}</tbody>
        </table>
      </td>
    </tr>
  </table>`;
}

function buildSkeletonSectionHtmlMap(
  sectionIds: MisEmailBodySectionId[],
  keyAccountNames: string[],
  layout: MisEmailBodyLayout
): Partial<Record<MisEmailBodySectionId, string>> {
  const resolved = resolveMisEmailBodyLayout(layout);
  const mergeRegionCells =
    resolved.mergeKeyAccountRegions === true && resolved.mode === 'grid';
  const map: Partial<Record<MisEmailBodySectionId, string>> = {};

  for (const id of sectionIds) {
    if (id === 'regional_performance') {
      map[id] = buildSkeletonPerformanceTable({
        title: 'Regional Performance',
        labelColumn: 'Region',
        rowLabels: [
          { label: 'North zone' },
          { label: 'South zone' },
          { label: 'East zone' },
          { label: 'West zone' },
          { label: 'All', isGrand: true },
        ],
        metricColumns: 9,
      });
    } else if (id === 'branch_performance') {
      map[id] = buildSkeletonPerformanceTable({
        title: 'Branch-wise Performance',
        labelColumn: 'Branch',
        rowLabels: [
          { label: 'Branch' },
          { label: 'Branch' },
          { label: 'Branch' },
          { label: 'Branch' },
          { label: 'Branch' },
        ],
        metricColumns: 9,
      });
    } else if (id === 'key_account_performance') {
      map[id] = buildSkeletonKeyAccountTable(keyAccountNames, mergeRegionCells);
    }
  }

  return map;
}

function buildSkeletonBodySectionsHtml(
  sectionIds: MisEmailBodySectionId[],
  keyAccountNames: string[],
  layout: MisEmailBodyLayout
): string {
  const sectionHtml = buildSkeletonSectionHtmlMap(sectionIds, keyAccountNames, layout);
  return composeEmailBodyGridHtml(sectionIds, sectionHtml, layout);
}

export function buildMisEmailSkeletonPreview(params: {
  preferences: MisEmailPreferences;
  permissions: {
    includeSummary: boolean;
    includeDetailed: boolean;
    includeKeyAccount: boolean;
  };
  scopeLabel: string;
  recipientName: string;
  recipientEmail: string;
  portalUrl?: string;
}): MisEmailSkeletonPreview | null {
  const effectiveIncludes = resolveEffectiveDigestIncludes(params.permissions, params.preferences);
  if (!hasAnyEffectiveDigestInclude(effectiveIncludes)) {
    return null;
  }

  const dateRange = resolveDigestDateRangeForPreferences(params.preferences);
  const bodyPermissions: MisEmailBodyPermissions = {
    includeSummary: effectiveIncludes.includeSummary,
    includeKeyAccount: effectiveIncludes.includeKeyAccount,
  };
  const bodySectionIds = resolveDigestBodySections(bodyPermissions, params.preferences, {
    includeKeyAccountAttachment: effectiveIncludes.includeKeyAccount,
  });

  const keyAccountNames = (params.preferences.keyAccountsInBody ?? []).filter(Boolean);
  const bodyLayout = resolveMisEmailBodyLayoutFromPrefs(params.preferences);
  const bodyHtml = buildSkeletonBodySectionsHtml(bodySectionIds, keyAccountNames, bodyLayout);
  const portalUrl = params.portalUrl?.replace(/\/$/, '') || '/report';

  const html = buildDigestEmailHtml({
    recipientName: params.recipientName,
    recipientEmail: params.recipientEmail,
    dateRange,
    scopeLabel: params.scopeLabel,
    portalUrl,
    bodyHtml,
  }, { forPreview: true });

  return {
    subject: formatDigestSubject(),
    scopeLabel: params.scopeLabel,
    dateRange,
    dateRangeLabel: formatReportPeriod(dateRange),
    attachments: resolveSkeletonAttachmentFilenames(effectiveIncludes),
    html,
    bodySectionIds,
  };
}
