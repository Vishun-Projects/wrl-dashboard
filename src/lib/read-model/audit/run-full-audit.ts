import { withClient } from '@/lib/read-model/db';
import { auditHotForward, applyHotAuditFixes } from '@/lib/read-model/audit/audit-hot';
import { auditHotReverse } from '@/lib/read-model/audit/audit-reverse';
import { auditDimensions, applyDimsAuditFixes } from '@/lib/read-model/audit/audit-dims';
import { auditFacts, applyFactsAuditFixes } from '@/lib/read-model/audit/audit-facts';
import { auditPlantMappings } from '@/lib/read-model/audit/audit-plant';
import {
  countTotalMismatches,
  createAuditReportWriter,
  printAuditSummary,
} from '@/lib/read-model/audit/report';
import type { AuditOptions, AuditPhase, AuditSummary } from '@/lib/read-model/audit/types';

const ALL_PHASES: AuditPhase[] = ['hot', 'dims', 'facts', 'plant', 'reverse'];

function parsePhases(raw?: string): AuditPhase[] {
  if (!raw) return ALL_PHASES;
  const parts = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean) as AuditPhase[];
  const valid = parts.filter((p) => ALL_PHASES.includes(p));
  return valid.length ? valid : ALL_PHASES;
}

export function parseAuditCliArgs(argv: string[]): AuditOptions {
  const apply = argv.includes('--apply');
  const onlyIdx = argv.indexOf('--only');
  const resumeIdx = argv.indexOf('--resume-from-trn');
  const skipReverse = argv.includes('--skip-reverse');

  return {
    apply,
    phases: parsePhases(onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined),
    resumeFromTrn: resumeIdx >= 0 ? argv[resumeIdx + 1] : undefined,
    skipReverse: skipReverse,
    onProgress: (message) => console.log(`[audit] ${message}`),
  };
}

export async function runFullReadModelAudit(opts: AuditOptions): Promise<AuditSummary> {
  const writer = createAuditReportWriter();
  const onMismatch = (mismatch: Parameters<NonNullable<AuditOptions['onMismatch']>>[0]) => {
    writer.writeMismatch(mismatch);
    opts.onMismatch?.(mismatch);
  };

  const summary: AuditSummary = {
    started_at: new Date().toISOString(),
    finished_at: null,
    apply_mode: opts.apply,
    phases_run: opts.phases,
    hot: null,
    dims: { offices: null, engineers: null, call_types: null },
    facts: null,
    plant: null,
    reverse: null,
    total_mismatches: 0,
    fixes_applied: {
      hot_upserted: 0,
      hot_deleted: 0,
      ncr_repaired: 0,
      dims_refreshed: false,
      facts_rebuilt: false,
    },
  };

  let hotFixes: { staleCrmRows: Record<string, unknown>[]; deleteTrns: string[] } | null = null;

  await withClient(async (client) => {
    if (opts.phases.includes('hot')) {
      const hotResult = await auditHotForward(client, {
        ...opts,
        onMismatch,
      });
      summary.hot = hotResult.summary;
      hotFixes = {
        staleCrmRows: hotResult.staleCrmRows,
        deleteTrns: hotResult.deleteTrns,
      };

      if (opts.apply && hotFixes) {
        const fixes = await applyHotAuditFixes(client, hotFixes);
        summary.fixes_applied.hot_upserted = fixes.hot_upserted;
        summary.fixes_applied.hot_deleted = fixes.hot_deleted;
        summary.fixes_applied.ncr_repaired = fixes.ncr_repaired;
      }
    }

    if (opts.phases.includes('dims')) {
      const dims = await auditDimensions(client, { ...opts, onMismatch });
      summary.dims = dims;
      if (opts.apply) {
        summary.fixes_applied.dims_refreshed = await applyDimsAuditFixes(client);
      }
    }

    if (opts.phases.includes('facts')) {
      summary.facts = await auditFacts(client, { ...opts, onMismatch });
      if (opts.apply) {
        summary.fixes_applied.facts_rebuilt = await applyFactsAuditFixes(client);
      }
    }

    if (opts.phases.includes('plant')) {
      summary.plant = await auditPlantMappings(client, { ...opts, onMismatch });
    }

    if (opts.phases.includes('reverse') && !opts.skipReverse) {
      summary.reverse = await auditHotReverse(client, { ...opts, onMismatch });
    }
  });

  summary.finished_at = new Date().toISOString();
  summary.total_mismatches = countTotalMismatches(summary);

  const summaryPath = writer.writeSummary(summary);
  printAuditSummary(summary);
  console.log(`\nReport: ${summaryPath}`);
  console.log(`Detail: ${writer.jsonlPath}`);

  return summary;
}

export function auditExitCode(summary: AuditSummary): number {
  return summary.total_mismatches > 0 ? 1 : 0;
}
