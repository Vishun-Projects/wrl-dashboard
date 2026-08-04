const LOG_PREFIX = '[mis-email/timing]';

export type MisEmailTimingStep = {
  name: string;
  durationMs: number;
  detail?: string;
};

export type MisEmailTimingReport = {
  label: string;
  totalMs: number;
  steps: MisEmailTimingStep[];
};

export class MisEmailTimer {
  private readonly startedAt = Date.now();
  private readonly steps: MisEmailTimingStep[] = [];
  private lastMark = this.startedAt;

  constructor(private readonly label: string) {}

  step(name: string, detail?: string): void {
    const now = Date.now();
    const durationMs = now - this.lastMark;
    this.steps.push({ name, durationMs, detail });
    this.lastMark = now;
    const detailSuffix = detail ? ` (${detail})` : '';
    console.log(`${LOG_PREFIX} ${this.label} · ${name}: ${durationMs}ms${detailSuffix}`);
  }

  async measure<T>(name: string, fn: () => Promise<T>, detail?: (result: T) => string): Promise<T> {
    const stepStarted = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - stepStarted;
      const detailText = detail?.(result);
      this.steps.push({ name, durationMs, detail: detailText });
      this.lastMark = Date.now();
      const detailSuffix = detailText ? ` (${detailText})` : '';
      console.log(`${LOG_PREFIX} ${this.label} · ${name}: ${durationMs}ms${detailSuffix}`);
      return result;
    } catch (err) {
      const durationMs = Date.now() - stepStarted;
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push({ name, durationMs, detail: `failed: ${message}` });
      this.lastMark = Date.now();
      console.error(`${LOG_PREFIX} ${this.label} · ${name}: ${durationMs}ms (failed: ${message})`);
      throw err;
    }
  }

  finish(extraDetail?: string): MisEmailTimingReport {
    const totalMs = Date.now() - this.startedAt;
    const report: MisEmailTimingReport = {
      label: this.label,
      totalMs,
      steps: [...this.steps],
    };
    const summary = this.steps
      .map((step) => `${step.name}=${step.durationMs}ms`)
      .join(', ');
    const extra = extraDetail ? ` · ${extraDetail}` : '';
    console.log(
      `${LOG_PREFIX} ${this.label} · total ${totalMs}ms${extra}${summary ? ` · ${summary}` : ''}`
    );
    return report;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
