/**
 * Fast manual CRM → hot sync through yesterday IST (UI button).
 * Incremental watermark pull + recent editedon replay + pipeline — not full YTD midnight job.
 */
import { formatLocalDate } from '@/lib/dates/local-date';
import { runEditedonCatchupRange } from '@/lib/read-model/editedon-catchup';
import { runIncrementalSync } from '@/lib/read-model/incremental';
import { runPipelineReconcile } from '@/lib/read-model/pipeline-reconcile';
import { runReconcileTechSolved } from '@/lib/read-model/reconcile-tech-solved';
import { istYesterdayYmd } from '@/lib/read-model/start-calls-hot-sync';

function subtractDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

export type FastCallsHotSyncResult = {
  ok: boolean;
  asOf: string;
  rowsUpserted: number;
  rowsDeleted: number;
  crmRowsFetched: number;
  catchupUpserted: number;
  pipelineRefreshed: number;
  techSolvedUpserted: number;
  detail: string;
  skippedReason?: string;
};

export async function runFastCallsHotSyncThroughYesterday(
  asOfInput?: string
): Promise<FastCallsHotSyncResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return {
      ok: false,
      asOf: asOfInput ?? istYesterdayYmd(),
      rowsUpserted: 0,
      rowsDeleted: 0,
      crmRowsFetched: 0,
      catchupUpserted: 0,
      pipelineRefreshed: 0,
      techSolvedUpserted: 0,
      detail: 'SYNC_WORKER_ENABLED is not true',
      skippedReason: 'SYNC_WORKER_ENABLED is not true',
    };
  }

  const asOf = asOfInput?.trim() || istYesterdayYmd();
  const catchupDays = Math.max(
    7,
    Number(process.env.MANUAL_SYNC_CATCHUP_DAYS ?? 21) || 21
  );
  const catchupFrom = subtractDays(asOf, catchupDays - 1);

  const prevUntil = process.env.SYNC_INCREMENTAL_UNTIL;
  process.env.SYNC_INCREMENTAL_UNTIL = asOf;
  delete process.env.MIDNIGHT_SYNC_AS_OF;

  let inc;
  try {
    inc = await runIncrementalSync();
  } finally {
    if (prevUntil === undefined) delete process.env.SYNC_INCREMENTAL_UNTIL;
    else process.env.SYNC_INCREMENTAL_UNTIL = prevUntil;
  }

  const catchup = await runEditedonCatchupRange(catchupFrom, asOf, {
    resume: true,
    retriesPerDay: 2,
  });

  let pipelineRefreshed = inc.pipelineReconciled ?? 0;
  if (inc.skipped) {
    const pipeline = await runPipelineReconcile();
    pipelineRefreshed = pipeline.refreshed ?? 0;
  }

  let techSolvedUpserted = inc.techSolvedReconciled ?? 0;
  if (inc.skipped) {
    const tech = await runReconcileTechSolved({
      apply: true,
      limit: Math.max(200, Number(process.env.RECONCILE_TECH_SOLVED_PER_RUN ?? 500) || 500),
    });
    techSolvedUpserted = tech.rowsUpserted ?? 0;
  }

  const rowsUpserted =
    (inc.rowsUpserted ?? 0) + (catchup.rowsUpserted ?? 0) + techSolvedUpserted;
  const ok = (inc.ok || Boolean(inc.skipped)) && catchup.ok !== false;

  const detail = ok
    ? `Synced through ${asOf}: ${rowsUpserted.toLocaleString('en-IN')} row(s) updated (CRM Δ ${inc.crmRowsFetched ?? 0}, catch-up ${catchup.rowsUpserted ?? 0})`
    : `Sync incomplete through ${asOf} — check VPS logs`;

  console.log(`[manual-calls-hot] ${detail}`);

  return {
    ok,
    asOf,
    rowsUpserted,
    rowsDeleted: inc.rowsDeleted ?? 0,
    crmRowsFetched: inc.crmRowsFetched ?? 0,
    catchupUpserted: catchup.rowsUpserted ?? 0,
    pipelineRefreshed,
    techSolvedUpserted,
    detail,
    skippedReason: inc.skipped ? inc.reason : undefined,
  };
}
