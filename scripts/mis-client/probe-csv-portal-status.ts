import { readFileSync, existsSync } from 'fs';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(process.cwd(), '.env.local') });

const CSV =
  process.argv[2] ??
  'C:/Users/Vishnu.Vishwakarma/Downloads/Raw/CRM_WRL_MIS_Register_2026-06-30.csv';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseCrmDate(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function classifyFromPortalCsv(statusRaw: string, solvedDateRaw: string) {
  const status = statusRaw.trim();
  const lower = status.toLowerCase();
  const solvedDate = parseCrmDate(solvedDateRaw);

  if (lower === 'cancelled' || lower.includes('cancel')) {
    return { bucket: 'cancelled', label: 'Cancelled', bsolved: false, bfastclose: false, solved: false };
  }
  // Portal export: isSolved if Closed/Solved label OR bsolved — CSV shows Solved Date when isSolved
  const solvedByLabel =
    lower.includes('closed') ||
    lower === 'solved' ||
    lower === 'pending' ||
    lower.includes('tech');
  const isSolved = Boolean(solvedDate) || solvedByLabel;

  if (isSolved) {
    if (lower.includes('tech')) {
      return {
        bucket: 'tech_solved',
        label: 'Tech. Solve Call',
        bsolved: false,
        bfastclose: true,
        solved: true,
      };
    }
    return {
      bucket: 'solved',
      label: lower.includes('closed') ? 'Closed' : 'Closed',
      bsolved: true,
      bfastclose: false,
      solved: true,
    };
  }
  if (lower.includes('assigned')) {
    return {
      bucket: 'assigned',
      label: 'Assigned',
      bsolved: false,
      bfastclose: false,
      solved: false,
    };
  }
  return {
    bucket: 'open_unallocated',
    label: 'Open Unallocated',
    bsolved: false,
    bfastclose: false,
    solved: false,
  };
}

function main() {
  if (!existsSync(CSV)) {
    console.error('missing', CSV);
    process.exit(1);
  }
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseCsvLine(lines[0]);
  const idx = (n: string) => h.findIndex((x) => x.replace(/"/g, '').trim() === n);

  let naiveOpen = 0;
  let portalOpen = 0;
  let portalSolved = 0;
  let solvedDateButOpenLabel = 0;

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if ((c[idx('Call Type')] ?? '').toUpperCase() !== 'BREAKDOWN') continue;
    const iso = parseCrmDate(c[idx('Date')] ?? '');
    if (!iso || iso < '2026-01-01' || iso > '2026-06-29') continue;

    const st = (c[idx('Status')] ?? '').trim().toLowerCase();
    const solvedDate = c[idx('Solved Date')] ?? '';
    if (st === 'cancelled') continue;
    if (st.includes('open') || st.includes('assigned') || st === 'open') naiveOpen++;
    const cls = classifyFromPortalCsv(c[idx('Status')] ?? '', solvedDate);
    if (cls.solved) portalSolved++;
    else portalOpen++;
    if (solvedDate.trim() && (st.includes('open') || st.includes('assigned'))) solvedDateButOpenLabel++;
  }

  console.log({
    naiveOpenByStatusText: naiveOpen,
    portalLogicOpen: portalOpen,
    portalLogicSolved: portalSolved,
    solvedDateButOpenStatusLabel: solvedDateButOpenLabel,
    targetExcelSummaryOpen: 8773,
    expectedCrmRawOpen: portalOpen,
    expectedUnionApprox: portalOpen + 71,
  });
}

main();
