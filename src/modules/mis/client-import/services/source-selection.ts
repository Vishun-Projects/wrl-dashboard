export type MisSourceSelection = {
  crm: boolean;
  clientSourceCodes: string[];
};

export const DEFAULT_MIS_SOURCE_SELECTION: MisSourceSelection = {
  crm: true,
  clientSourceCodes: ['coke', 'cadbury'],
};

const STORAGE_KEY = 'mis_source_selection_v1';

export function hasClientSources(selection: MisSourceSelection): boolean {
  return selection.clientSourceCodes.length > 0;
}

export function isClientOnlyMode(selection: MisSourceSelection): boolean {
  return hasClientSources(selection) && !selection.crm;
}

export function parseSourceCodesParam(raw: string | null): string[] | null {
  if (!raw?.trim()) return null;
  const codes = raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  return codes.length ? codes : null;
}

export function sourceCodesToParam(codes: string[]): string | undefined {
  const normalized = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  return normalized.length ? normalized.join(',') : undefined;
}

export function loadMisSourceSelection(): MisSourceSelection {
  if (typeof window === 'undefined') return { ...DEFAULT_MIS_SOURCE_SELECTION };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MIS_SOURCE_SELECTION };
    const parsed = JSON.parse(raw) as Partial<MisSourceSelection>;
    return {
      crm: parsed.crm !== false,
      clientSourceCodes: Array.isArray(parsed.clientSourceCodes)
        ? parsed.clientSourceCodes.map((c) => String(c).toLowerCase())
        : [...DEFAULT_MIS_SOURCE_SELECTION.clientSourceCodes],
    };
  } catch {
    return { ...DEFAULT_MIS_SOURCE_SELECTION };
  }
}

export function saveMisSourceSelection(selection: MisSourceSelection): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
}

export function selectAllSources(
  activeSourceCodes: string[]
): MisSourceSelection {
  return {
    crm: true,
    clientSourceCodes: [...activeSourceCodes],
  };
}
