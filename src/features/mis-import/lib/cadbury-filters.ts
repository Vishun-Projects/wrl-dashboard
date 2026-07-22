/** Cadbury VMS exports include other ASPs; WRL MIS only ingests WRL-handled providers. */
export const CADBURY_EXCLUDED_SERVICE_PROVIDERS = [
  'span spectrum pvt ltd',
  'punjab refrigeration',
] as const;

const SERVICE_PROVIDER_COLUMNS = ['Service_Provider', 'Service Provider'];

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function readServiceProvider(rawRow: Record<string, string>): string {
  for (const column of SERVICE_PROVIDER_COLUMNS) {
    const value = rawRow[column]?.trim();
    if (value) return value;
  }
  return '';
}

export function isCadburyExcludedServiceProvider(provider: string): boolean {
  if (!provider) return false;
  const normalized = normalizeProviderName(provider);
  return (CADBURY_EXCLUDED_SERVICE_PROVIDERS as readonly string[]).includes(normalized);
}

export function shouldSkipCadburyImportRow(
  sourceCode: string,
  rawRow: Record<string, string>
): boolean {
  if (sourceCode !== 'cadbury') return false;
  return isCadburyExcludedServiceProvider(readServiceProvider(rawRow));
}
