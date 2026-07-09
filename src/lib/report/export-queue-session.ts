const INTERRUPTED_KEY = 'mis-export-interrupted';

export function markExportInterrupted(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(INTERRUPTED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeExportInterruptedFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = sessionStorage.getItem(INTERRUPTED_KEY);
    if (!value) return false;
    sessionStorage.removeItem(INTERRUPTED_KEY);
    return true;
  } catch {
    return false;
  }
}
