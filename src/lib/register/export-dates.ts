/** Register CSV/Excel date cells — matches on-screen "15 Feb 2026" format. */
export function formatRegisterExportDate(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.includes('/') && trimmed.split('/')[0].length <= 2) {
      const parts = trimmed.split(' ')[0].split('/');
      if (parts.length === 3) {
        const [d, m, y] = parts;
        const parsed = new Date(`${y}-${m}-${d}`);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
        }
      }
    }
  }

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
