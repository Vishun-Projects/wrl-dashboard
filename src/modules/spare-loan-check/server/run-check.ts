import {
  classifySpareLoanRow,
  selectMatchKey,
  toProblemRow,
} from '@/modules/spare-loan-check/server/match';
import { lookupCallsByVtrnno } from '@/modules/spare-loan-check/server/lookup';
import { parseZss02Html } from '@/modules/spare-loan-check/server/parse-zss02-html';
import type {
  SpareLoanCheckResponse,
  SpareLoanCheckSummary,
  SpareLoanProblemReason,
  SpareLoanProblemRow,
} from '@/modules/spare-loan-check/types';

function emptyByReason(): Record<SpareLoanProblemReason, number> {
  return {
    vendor_mismatch: 0,
    cancelled: 0,
  };
}

export async function runSpareLoanCheck(html: string): Promise<SpareLoanCheckResponse> {
  const parsedRows = parseZss02Html(html);
  const keyed: Array<{
    row: (typeof parsedRows)[number];
    match: NonNullable<ReturnType<typeof selectMatchKey>>;
  }> = [];
  let skipped = 0;

  for (const row of parsedRows) {
    const match = selectMatchKey(row.soLoan, row.soConRtn);
    if (!match) {
      skipped += 1;
      continue;
    }
    keyed.push({ row, match });
  }

  const callMap = await lookupCallsByVtrnno(keyed.map((k) => k.match.key));
  const problems: SpareLoanProblemRow[] = [];
  const byReason = emptyByReason();
  let ok = 0;

  for (const { row, match } of keyed) {
    const call = callMap.get(match.key);
    const reason = classifySpareLoanRow(row.vendorNo, call);
    if (!reason) {
      ok += 1;
      continue;
    }
    byReason[reason] += 1;
    problems.push(toProblemRow(row, match, reason, call));
  }

  const summary: SpareLoanCheckSummary = {
    parsed: parsedRows.length,
    skipped,
    ok,
    problems: problems.length,
    byReason,
  };

  return { summary, rows: problems };
}
