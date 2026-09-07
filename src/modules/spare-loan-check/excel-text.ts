/** Force Excel to treat a CSV cell as text (avoids scientific notation on long digits). */
export function excelTextFormula(value: string): string {
  const s = String(value ?? '');
  if (!s) return '';
  return `="${s.replace(/"/g, '""')}"`;
}
