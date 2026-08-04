/**
 * Build standalone HTML trend charts from Western CRM (live aggregates).
 *
 * Usage: npm run arcp-trends-html
 *        npm run arcp-trends-html -- 2025-01 2026-05
 * Output: docs/arcp-trends-overview.html (open in any browser)
 *
 * Resumes partial runs from .cache/arcp-trends-crm.json when present.
 */
import fs from 'fs';
import path from 'path';
import '@/lib/read-model/bootstrap-env';
import { arcpBackfillStartDate } from '@/modules/arcp-claims/server/sync/dates';
import { fetchArcpClaimsAggregates } from '@/modules/arcp-claims/server/fetch';
import {
  type ArcpClaimsAggregateRow,
  type ArcpClaimsQueryOpts,
} from '@/sql/arcp-claims/query';

type MonthMetrics = {
  month: string;
  lineCount: number;
  amountPayable: number;
  branchApproved: number;
  hoApproved: number;
};

type TrendBundle = {
  label: string;
  key: string;
  minMonth: string | null;
  maxMonth: string | null;
  points: MonthMetrics[];
};

const CRM_TIMEOUT_MS = Number(process.env.ARCP_TRENDS_CRM_TIMEOUT_MS ?? 300_000);
const FETCH_GAP_MS = Number(process.env.ARCP_TRENDS_GAP_MS ?? 2000);
const CACHE_PATH = path.join(process.cwd(), '.cache', 'arcp-trends-crm.json');

type DateBasis = {
  label: string;
  key: TrendBundle['key'];
  column: NonNullable<ArcpClaimsQueryOpts['dateFilterColumn']>;
};

const DATE_BASES: DateBasis[] = [
  { label: 'Call Date', key: 'callDate', column: 'dcalllogdatetime' },
  { label: 'BM Call Approved', key: 'bmApproved', column: 'bm_approved_at' },
  { label: 'HO Call Approved', key: 'hoApproved', column: 'ho_approved_at' },
];

type TrendsCache = {
  version: 1;
  entries: Record<string, MonthMetrics | 'failed'>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(month: string, column: string): string {
  return `${month}|${column}`;
}

function loadCache(): TrendsCache {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as TrendsCache;
    if (parsed?.version === 1 && parsed.entries) return parsed;
  } catch {
    /* no cache */
  }
  return { version: 1, entries: {} };
}

function saveCache(cache: TrendsCache): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0));
  const d = String(end.getUTCDate()).padStart(2, '0');
  return `${y}-${String(m).padStart(2, '0')}-${d}`;
}

function monthBounds(yyyyMm: string): { start: string; end: string } {
  return { start: `${yyyyMm}-01`, end: lastDayOfMonth(yyyyMm) };
}

function rollupMonth(rows: ArcpClaimsAggregateRow[], month: string): MonthMetrics {
  let lineCount = 0;
  let amountPayable = 0;
  let branchApproved = 0;
  let hoApproved = 0;
  for (const row of rows) {
    lineCount += Number(row.qty ?? 0);
    amountPayable += Number(row.amount_payable ?? 0);
    branchApproved += Number(row.branch_approved ?? 0);
    hoApproved += Number(row.ho_approved ?? 0);
  }
  return { month, lineCount, amountPayable, branchApproved, hoApproved };
}

async function fetchCrmMonth(
  month: string,
  column: NonNullable<ArcpClaimsQueryOpts['dateFilterColumn']>
): Promise<MonthMetrics | null> {
  const { start, end } = monthBounds(month);
  const rows = await fetchArcpClaimsAggregates(
    {
      startDate: start,
      endDate: end,
      dateFilterColumn: column,
      crmUiFast: true,
    },
    CRM_TIMEOUT_MS
  );
  return rollupMonth(rows, month);
}

async function fetchCrmMonthlySeries(
  basis: DateBasis,
  monthAxis: string[],
  cache: TrendsCache
): Promise<MonthMetrics[]> {
  const points: MonthMetrics[] = [];
  for (const month of monthAxis) {
    const key = cacheKey(month, basis.column);
    const cached = cache.entries[key];
    if (cached === 'failed') {
      console.warn(`  skip (cached failure) ${basis.label} ${month}`);
      continue;
    }
    if (cached && typeof cached === 'object') {
      points.push(cached);
      continue;
    }

    process.stdout.write(`  CRM ${basis.label} ${month} … `);
    try {
      const hit = await fetchCrmMonth(month, basis.column);
      if (hit) {
        cache.entries[key] = hit;
        points.push(hit);
        console.log(
          `${(hit.amountPayable / 100000).toFixed(2)} L · ${hit.lineCount} lines`
        );
      }
    } catch (err) {
      cache.entries[key] = 'failed';
      console.log('FAILED');
      console.warn(err);
    }
    saveCache(cache);
    if (FETCH_GAP_MS > 0) await sleep(FETCH_GAP_MS);
  }
  points.sort((a, b) => a.month.localeCompare(b.month));
  return points;
}

function monthRange(start: string, end: string): string[] {
  const months: string[] = [];
  const cursor = new Date(`${start}-01T00:00:00Z`);
  const last = new Date(`${end}-01T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return months;
  while (cursor <= last) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function alignToMonths(
  points: MonthMetrics[],
  months: string[],
  sparse: boolean
): (MonthMetrics | null)[] {
  const byMonth = new Map(points.map((p) => [p.month, p]));
  return months.map((month) => {
    const hit = byMonth.get(month);
    if (hit) return hit;
    if (sparse) return null;
    return {
      month,
      lineCount: 0,
      amountPayable: 0,
      branchApproved: 0,
      hoApproved: 0,
    };
  });
}

function buildHtml(payload: {
  generatedAt: string;
  dataSource: string;
  rowCount: number;
  backfillStart: string;
  globalMin: string;
  globalMax: string;
  bundles: TrendBundle[];
  monthAxis: string[];
  chartData: {
    labels: string[];
    callDate: Record<string, (number | null)[]>;
    bmApproved: Record<string, (number | null)[]>;
    hoApproved: Record<string, (number | null)[]>;
  };
}): string {
  const dataJson = JSON.stringify(payload.chartData).replace(/</g, '\\u003c');
  const metaJson = JSON.stringify({
    generatedAt: payload.generatedAt,
    dataSource: payload.dataSource,
    rowCount: payload.rowCount,
    backfillStart: payload.backfillStart,
    globalMin: payload.globalMin,
    globalMax: payload.globalMax,
    bundles: payload.bundles.map((b) => ({
      label: b.label,
      key: b.key,
      minMonth: b.minMonth,
      maxMonth: b.maxMonth,
      totalAmount: b.points.reduce((s, p) => s + p.amountPayable, 0),
      totalBranch: b.points.reduce((s, p) => s + p.branchApproved, 0),
      totalHo: b.points.reduce((s, p) => s + p.hoApproved, 0),
      totalLines: b.points.reduce((s, p) => s + p.lineCount, 0),
    })),
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ARCP Monthly Trends — Call / BM / HO</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --text: #e7ecf3;
      --muted: #8b9cb3;
      --call: #38bdf8;
      --bm: #a78bfa;
      --ho: #34d399;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px 28px 48px;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 6px; }
    .sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 24px; max-width: 900px; line-height: 1.5; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card);
      border-radius: 10px;
      padding: 14px 16px;
      border: 1px solid #2a3548;
    }
    .card h3 { margin: 0 0 8px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .card .val { font-size: 1.15rem; font-weight: 600; }
    .card .range { font-size: 0.8rem; color: var(--muted); margin-top: 6px; }
    .panel {
      background: var(--card);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #2a3548;
    }
    .panel h2 { margin: 0 0 4px; font-size: 1.05rem; }
    .panel p { margin: 0 0 16px; color: var(--muted); font-size: 0.85rem; }
    .chart-wrap { position: relative; height: 340px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    th, td {
      padding: 8px 10px;
      text-align: right;
      border-bottom: 1px solid #2a3548;
    }
    th:first-child, td:first-child { text-align: left; }
    th { color: var(--muted); font-weight: 500; }
    .legend { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; font-size: 0.85rem; }
    .legend span::before {
      content: "";
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .legend .call::before { background: var(--call); }
    .legend .bm::before { background: var(--bm); }
    .legend .ho::before { background: var(--ho); }
  </style>
</head>
<body>
  <h1>ARCP monthly trends</h1>
  <p class="sub" id="meta"></p>

  <div class="cards" id="summary-cards"></div>

  <div class="panel">
    <h2>Amount payable (₹) by calendar month</h2>
    <p>Which month lines fall into depends on date basis —Call Date vs BM vs HO approval are different row sets.</p>
    <div class="legend">
      <span class="call">Call Date</span>
      <span class="bm">BM Call Approved</span>
      <span class="ho">HO Call Approved</span>
    </div>
    <div class="chart-wrap"><canvas id="chartPayable"></canvas></div>
  </div>

  <div class="panel">
    <h2>Branch approved (₹)</h2>
    <div class="chart-wrap"><canvas id="chartBranch"></canvas></div>
  </div>

  <div class="panel">
    <h2>HO approved (₹)</h2>
    <div class="chart-wrap"><canvas id="chartHo"></canvas></div>
  </div>

  <div class="panel">
    <h2>Line count (included ARCP rows)</h2>
    <div class="chart-wrap"><canvas id="chartLines"></canvas></div>
  </div>

  <div class="panel">
    <h2>Monthly overview table (amount payable, ₹ lakh)</h2>
    <div style="overflow-x: auto">
      <table id="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Call Date</th>
            <th>BM Approved</th>
            <th>HO Approved</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </div>

  <script>
    const META = ${metaJson};
    const CHART = ${dataJson};

    const fmtLakh = (n) => {
      if (n == null || !Number.isFinite(n)) return '—';
      return (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' L';
    };
    const fmtInr = (n) => {
      if (n == null || !Number.isFinite(n)) return '—';
      return '₹' + Math.round(n).toLocaleString('en-IN');
    };

    document.getElementById('meta').textContent =
      'Generated ' + META.generatedAt + ' · source: ' + META.dataSource +
      ' · ' + META.rowCount.toLocaleString('en-IN') + ' claim lines (summed monthly)' +
      ' · range ' + META.globalMin + ' → ' + META.globalMax +
      ' · Postgres backfill from ' + META.backfillStart + ' (reference only)';

    const cardEl = document.getElementById('summary-cards');
    for (const b of META.bundles) {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML =
        '<h3>' + b.label + '</h3>' +
        '<div class="val">' + fmtLakh(b.totalAmount) + ' payable</div>' +
        '<div class="range">' + (b.minMonth || '—') + ' → ' + (b.maxMonth || '—') +
        '<br>' + b.totalLines.toLocaleString('en-IN') + ' lines</div>';
      cardEl.appendChild(div);
    }

    const colors = {
      callDate: { border: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
      bmApproved: { border: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
      hoApproved: { border: '#34d399', bg: 'rgba(52,211,153,0.12)' },
    };

    function makeChart(canvasId, metric) {
      const ctx = document.getElementById(canvasId);
      return new Chart(ctx, {
        type: 'line',
        data: {
          labels: CHART.labels,
          datasets: [
            {
              label: 'Call Date',
              data: CHART.callDate[metric],
              borderColor: colors.callDate.border,
              backgroundColor: colors.callDate.bg,
              tension: 0.25,
              spanGaps: false,
              pointRadius: 3,
            },
            {
              label: 'BM Approved',
              data: CHART.bmApproved[metric],
              borderColor: colors.bmApproved.border,
              backgroundColor: colors.bmApproved.bg,
              tension: 0.25,
              spanGaps: false,
              pointRadius: 3,
            },
            {
              label: 'HO Approved',
              data: CHART.hoApproved[metric],
              borderColor: colors.hoApproved.border,
              backgroundColor: colors.hoApproved.bg,
              tension: 0.25,
              spanGaps: false,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = ctx.raw;
                  if (metric === 'lineCount') return ctx.dataset.label + ': ' + (v ?? '—');
                  return ctx.dataset.label + ': ' + fmtInr(v);
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#8b9cb3', maxRotation: 45 },
              grid: { color: '#2a3548' },
            },
            y: {
              ticks: {
                color: '#8b9cb3',
                callback: (v) => metric === 'lineCount' ? v : fmtLakh(v),
              },
              grid: { color: '#2a3548' },
            },
          },
        },
      });
    }

    makeChart('chartPayable', 'amountPayable');
    makeChart('chartBranch', 'branchApproved');
    makeChart('chartHo', 'hoApproved');
    makeChart('chartLines', 'lineCount');

    const tbody = document.querySelector('#data-table tbody');
    for (let i = 0; i < CHART.labels.length; i++) {
      const tr = document.createElement('tr');
      const c = CHART.callDate.amountPayable[i];
      const b = CHART.bmApproved.amountPayable[i];
      const h = CHART.hoApproved.amountPayable[i];
      if (c == null && b == null && h == null) continue;
      tr.innerHTML =
        '<td>' + CHART.labels[i] + '</td>' +
        '<td>' + fmtLakh(c) + '</td>' +
        '<td>' + fmtLakh(b) + '</td>' +
        '<td>' + fmtLakh(h) + '</td>';
      tbody.appendChild(tr);
    }
  </script>
</body>
</html>`;
}

function seriesFromAligned(
  aligned: (MonthMetrics | null)[],
  field: keyof Omit<MonthMetrics, 'month'>
): (number | null)[] {
  return aligned.map((p) => (p == null ? null : p[field]));
}

async function main() {
  const argMin = process.argv[2]?.match(/^\d{4}-\d{2}$/) ? process.argv[2] : null;
  const argMax = process.argv[3]?.match(/^\d{4}-\d{2}$/) ? process.argv[3] : null;
  const globalMin = argMin ?? arcpBackfillStartDate().slice(0, 7);
  const globalMax = argMax ?? new Date().toISOString().slice(0, 7);
  const monthAxis = monthRange(globalMin, globalMax);

  console.log(
    `Fetching ${monthAxis.length} months × ${DATE_BASES.length} date bases from CRM (${globalMin} → ${globalMax})…`
  );
  console.log(`Timeout ${CRM_TIMEOUT_MS}ms · gap ${FETCH_GAP_MS}ms · cache ${CACHE_PATH}`);

  const cache = loadCache();
  const seriesByKey = new Map<TrendBundle['key'], MonthMetrics[]>();

  for (const basis of DATE_BASES) {
    console.log(`\n${basis.label} (${basis.column})`);
    const points = await fetchCrmMonthlySeries(basis, monthAxis, cache);
    seriesByKey.set(basis.key, points);
  }

  const callPoints = seriesByKey.get('callDate') ?? [];
  const bmPoints = seriesByKey.get('bmApproved') ?? [];
  const hoPoints = seriesByKey.get('hoApproved') ?? [];

  const bundles: TrendBundle[] = DATE_BASES.map((basis) => {
    const points = seriesByKey.get(basis.key) ?? [];
    return {
      label: basis.label,
      key: basis.key,
      minMonth: points[0]?.month ?? null,
      maxMonth: points[points.length - 1]?.month ?? null,
      points,
    };
  });

  const rowCount = bundles.reduce((s, b) => s + b.points.reduce((t, p) => t + p.lineCount, 0), 0);

  const callAligned = alignToMonths(callPoints, monthAxis, false);
  const bmAligned = alignToMonths(bmPoints, monthAxis, true);
  const hoAligned = alignToMonths(hoPoints, monthAxis, true);

  const chartData = {
    labels: monthAxis,
    callDate: {
      amountPayable: seriesFromAligned(callAligned, 'amountPayable'),
      branchApproved: seriesFromAligned(callAligned, 'branchApproved'),
      hoApproved: seriesFromAligned(callAligned, 'hoApproved'),
      lineCount: seriesFromAligned(callAligned, 'lineCount'),
    },
    bmApproved: {
      amountPayable: seriesFromAligned(bmAligned, 'amountPayable'),
      branchApproved: seriesFromAligned(bmAligned, 'branchApproved'),
      hoApproved: seriesFromAligned(bmAligned, 'hoApproved'),
      lineCount: seriesFromAligned(bmAligned, 'lineCount'),
    },
    hoApproved: {
      amountPayable: seriesFromAligned(hoAligned, 'amountPayable'),
      branchApproved: seriesFromAligned(hoAligned, 'branchApproved'),
      hoApproved: seriesFromAligned(hoAligned, 'hoApproved'),
      lineCount: seriesFromAligned(hoAligned, 'lineCount'),
    },
  };

  const html = buildHtml({
    generatedAt: new Date().toISOString(),
    dataSource: 'Western CRM (live aggregates)',
    rowCount,
    backfillStart: arcpBackfillStartDate(),
    globalMin,
    globalMax,
    bundles,
    monthAxis,
    chartData,
  });

  const outPath = path.join(process.cwd(), 'docs', 'arcp-trends-overview.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  console.log('\nWrote', outPath);
  console.log('Claim lines (sum of monthly CRM qty):', rowCount);
  for (const b of bundles) {
    const total = b.points.reduce((s, p) => s + p.amountPayable, 0);
    console.log(
      `  ${b.label}: ${b.points.length} months, ${(total / 100000).toFixed(2)} L payable (${b.minMonth} → ${b.maxMonth})`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
