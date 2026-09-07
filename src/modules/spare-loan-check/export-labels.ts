/** Filename-safe slug for ZIP/CSV downloads. */
export function safeFilePart(value: string): string {
  const s = value
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return s.slice(0, 80) || 'unknown';
}

/**
 * Code + branch name for filenames.
 * CRM often stores "1152 - BANGALORE BRANCH" — use that as-is when present.
 */
export function branchFileLabel(plant: string, plantName: string | null | undefined): string {
  const code = plant.trim();
  const name = plantName?.trim();
  if (!name) return code || 'unknown';
  if (!code) return name;
  if (name.toUpperCase().startsWith(code.toUpperCase())) return name;
  return `${code} - ${name}`;
}

/** CSV Plant cell: prefer CRM name (already includes code when present). */
export function plantExportValue(plant: string, plantName: string | null | undefined): string {
  return branchFileLabel(plant, plantName);
}
