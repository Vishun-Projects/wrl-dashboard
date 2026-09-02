export type ReadSource = 'crm' | 'postgres';

export function readSourceFromEnv(
  specific: string | undefined,
  global: string | undefined
): ReadSource {
  const specificNorm = specific?.toLowerCase();
  if (specificNorm === 'postgres' || specificNorm === 'crm') return specificNorm;
  const globalNorm = global?.toLowerCase();
  if (globalNorm === 'postgres' || globalNorm === 'crm') return globalNorm;
  return 'crm';
}
