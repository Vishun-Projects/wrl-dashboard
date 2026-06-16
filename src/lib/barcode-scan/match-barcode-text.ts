/** Normalize barcode / OCR text for comparison (strip punctuation, lowercase). */
export function normalizeBarcodeToken(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function directOrPartialMatch(hay: string, normBarcode: string): boolean {
  if (!hay || normBarcode.length < 6) return false;
  if (hay.includes(normBarcode)) return true;

  if (normBarcode.length >= 12) {
    const tail = normBarcode.slice(-10);
    if (tail.length >= 8 && hay.includes(tail)) return true;
  }

  const minLen = Math.max(8, Math.min(10, normBarcode.length - 2));
  for (let len = Math.min(14, normBarcode.length); len >= minLen; len -= 1) {
    for (let i = 0; i <= normBarcode.length - len; i += 1) {
      if (hay.includes(normBarcode.slice(i, i + len))) return true;
    }
  }
  return false;
}

/** OCR often confuses similar glyphs — allow small edit distance on barcode-length windows. */
function fuzzyWindowMatch(hay: string, normBarcode: string): boolean {
  if (hay.length < 8 || normBarcode.length < 8) return false;

  const maxErrors = normBarcode.length >= 14 ? 2 : normBarcode.length >= 10 ? 2 : 1;
  const windowSizes = [...new Set([normBarcode.length, 14, 12, 10, 8])].filter(
    (n) => n >= 8 && n <= normBarcode.length
  );

  for (const winLen of windowSizes) {
    for (let i = 0; i <= normBarcode.length - winLen; i += 1) {
      const needle = normBarcode.slice(i, i + winLen);
      const errBudget = needle.length >= 12 ? maxErrors : Math.min(maxErrors, 1);
      for (let j = 0; j <= hay.length - winLen; j += 1) {
        if (editDistanceAtMost(needle, hay.slice(j, j + winLen), errBudget)) return true;
      }
    }
  }
  return false;
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (a.length !== b.length) return false;
  let errors = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i] || ocrEquivalent(a[i], b[i])) continue;
    errors += 1;
    if (errors > max) return false;
  }
  return true;
}

function ocrEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const pair = `${a}${b}`;
  return (
    /[o0]/.test(pair) && 'o0'.includes(a) && 'o0'.includes(b) ||
    /[il1]/.test(pair) && 'il1'.includes(a) && 'il1'.includes(b) ||
    /[s5]/.test(pair) && 's5'.includes(a) && 's5'.includes(b) ||
    /[b8]/.test(pair) && 'b8'.includes(a) && 'b8'.includes(b) ||
    /[z2]/.test(pair) && 'z2'.includes(a) && 'z2'.includes(b) ||
    /[g6]/.test(pair) && 'g6'.includes(a) && 'g6'.includes(b)
  );
}

/** True when OCR text, tokens, or decoded barcodes contain the target serial. */
export function barcodeMatchesOcrText(
  barcode: string,
  text: string,
  tokens: string[] = [],
  decodedBarcodes: string[] = []
): boolean {
  const norm = normalizeBarcodeToken(barcode);
  if (norm.length < 6) return false;

  const haySources = new Set<string>();
  const full = normalizeBarcodeToken(text);
  if (full) haySources.add(full);
  for (const token of [...tokens, ...decodedBarcodes]) {
    const t = normalizeBarcodeToken(token);
    if (t) haySources.add(t);
  }

  for (const hay of haySources) {
    if (directOrPartialMatch(hay, norm)) return true;
    if (fuzzyWindowMatch(hay, norm)) return true;
  }

  // Also scan the full OCR blob for embedded barcode windows.
  if (full && full.length >= norm.length) {
    if (fuzzyWindowMatch(full, norm)) return true;
  }

  return false;
}
