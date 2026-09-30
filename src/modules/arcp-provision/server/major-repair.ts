/** BREAKDOWN provision: only these repairs use Major rate-card rows. */
export const PROVISION_MAJOR_REPAIR_CODES = ['6', '19'] as const;
export const PROVISION_MAJOR_REPAIR_LABELS = [
  'Gas Charging Done',
  'Compressor Replaced',
] as const;

const CODE_SET = new Set<string>(PROVISION_MAJOR_REPAIR_CODES);
const LABEL_SET = new Set(
  PROVISION_MAJOR_REPAIR_LABELS.map((s) => s.trim().toUpperCase())
);

export function isBreakdownCallType(
  callTypeLabel: string | null | undefined,
  ncalltype: string | null | undefined
): boolean {
  const label = (callTypeLabel ?? '').trim().toUpperCase();
  if (label.includes('BREAKDOWN')) return true;
  return (ncalltype ?? '').trim() === '35';
}

export function isProvisionMajorRepair(
  nrepairtype: string | null | undefined,
  repairLabel: string | null | undefined
): boolean {
  const code = (nrepairtype ?? '').trim();
  if (code && CODE_SET.has(code)) return true;
  const label = (repairLabel ?? '').trim().toUpperCase();
  return label.length > 0 && LABEL_SET.has(label);
}

/** BREAKDOWN → major only for Gas Charging Done / Compressor Replaced; else keep CRM major flag. */
export function resolveProvisionIsMajor(opts: {
  callTypeLabel: string | null | undefined;
  ncalltype: string | null | undefined;
  nrepairtype: string | null | undefined;
  repairLabel: string | null | undefined;
  crmIsMajor: boolean;
}): boolean {
  if (isBreakdownCallType(opts.callTypeLabel, opts.ncalltype)) {
    return isProvisionMajorRepair(opts.nrepairtype, opts.repairLabel);
  }
  return opts.crmIsMajor;
}

/**
 * SQL boolean for hot alias `h` — same rule as resolveProvisionIsMajor for BREAKDOWN.
 * Use COALESCE so NULL nrepairtype yields false (not UNKNOWN) inside NOT (...).
 */
export const PROVISION_IS_MAJOR_SQL = `(
  (
    UPPER(COALESCE(h.call_type_label, '')) LIKE '%BREAKDOWN%'
    OR COALESCE(NULLIF(BTRIM(h.ncalltype), ''), '') = '35'
  )
  AND (
    COALESCE(NULLIF(BTRIM(h.nrepairtype), ''), '') IN ('6', '19')
    OR UPPER(BTRIM(COALESCE(h.repair_label, ''))) IN (
      'GAS CHARGING DONE',
      'COMPRESSOR REPLACED'
    )
  )
)`;
