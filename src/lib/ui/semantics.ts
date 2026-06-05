/**
 * Central semantic color tokens — red=error, amber=warning, green=success, blue=info.
 * Domain repair hues (motor/compressor/gas) are separate from status semantics.
 */

export const statusSemantics = {
  error: 'text-rose-700',
  errorBg: 'bg-rose-50 border-rose-200 text-rose-700',
  warning: 'text-amber-700',
  warningBg: 'bg-amber-50 border-amber-200 text-amber-700',
  success: 'text-emerald-700',
  successBg: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  info: 'text-blue-700',
  infoBg: 'bg-blue-50 border-blue-200 text-blue-700',
  neutral: 'text-slate-600',
  neutralBg: 'bg-slate-50 border-slate-200 text-slate-600',
} as const;

export const auditSemantics = {
  pass: statusSemantics.successBg,
  fail: statusSemantics.errorBg,
  review: statusSemantics.warningBg,
} as const;

/** Serial audit repair badge colors — domain-specific, not pass/fail. */
export const repairSemantics = {
  motor: 'bg-violet-100 text-violet-800 border-violet-200',
  compressor: 'border border-rose-300/80 bg-[#ffaeae] text-black font-bold',
  gas: 'bg-teal-100 text-teal-800 border-teal-200',
  motorText: 'text-violet-700',
  compressorText: 'text-rose-700',
  gasText: 'text-teal-700',
} as const;

/** Distribution open-call backlog thresholds. */
export type DistributionLoadLevel = 'balanced' | 'warning' | 'critical';

export function distributionOpenCallLevel(openCalls: number): DistributionLoadLevel {
  if (openCalls > 15) return 'critical';
  if (openCalls >= 8) return 'warning';
  return 'balanced';
}

export function distributionOpenCallClasses(level: DistributionLoadLevel): string {
  switch (level) {
    case 'critical':
      return 'text-rose-700 font-semibold';
    case 'warning':
      return 'text-amber-700 font-medium';
    default:
      return 'text-emerald-700';
  }
}

export function distributionRatioLevel(ratio: number): DistributionLoadLevel {
  if (ratio > 15) return 'critical';
  if (ratio > 7) return 'warning';
  return 'balanced';
}
