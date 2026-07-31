/** Substitute {date} / {reason} in watchdog subject/body templates. */
export function applyWatchdogPlaceholders(
  template: string,
  vars: { date: string; reason: string }
): string {
  return template.replaceAll('{date}', vars.date).replaceAll('{reason}', vars.reason);
}

export function formatWatchdogAlert(opts: {
  subjectTemplate: string;
  bodyTemplate: string;
  date: string;
  reason: string;
}): { subject: string; body: string } {
  const vars = { date: opts.date, reason: opts.reason };
  return {
    subject: applyWatchdogPlaceholders(opts.subjectTemplate, vars),
    body: applyWatchdogPlaceholders(opts.bodyTemplate, vars),
  };
}
