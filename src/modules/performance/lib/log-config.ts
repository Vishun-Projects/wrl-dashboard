/** Server-side: append JSONL to logs/performance/ when true. */
export function performanceLogEnabledServer(): boolean {
  const flag = process.env.PERFORMANCE_LOG_ENABLED?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return process.env.NODE_ENV === 'development';
}

/** Client-side: collect and POST metrics when true. */
export function performanceLogEnabledClient(): boolean {
  const flag = process.env.NEXT_PUBLIC_PERFORMANCE_LOG?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  return process.env.NODE_ENV === 'development';
}

export function performanceLogDir(): string {
  return process.env.PERFORMANCE_LOG_DIR?.trim() || 'logs/performance';
}
