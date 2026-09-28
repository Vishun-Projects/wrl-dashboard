/** YY + month A–L + DD + running number, e.g. 25G281371 / 25G28576. */
const CALL_RE = /\d{2}[A-L]\d{2}\d+/gi;

function isPlausibleCall(token: string): boolean {
  if (!/^\d{2}[A-L]\d{2}\d+$/.test(token)) return false;
  const dd = Number(token.slice(3, 5));
  return dd >= 1 && dd <= 31;
}

/** Invoice refs are not calls (`INV NO.1302602482 12.08.2026`). */
function stripInvoiceNoise(raw: string): string {
  return raw.replace(/\binv(?:oice)?\s*no\.?\s*[0-9][0-9./-]*/gi, ' ');
}

/** Pull every well-formed call token from MB51 Text (slash/name junk ignored). */
export function extractCallNumbers(raw: string): string[] {
  if (!raw) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of stripInvoiceNoise(raw).toUpperCase().match(CALL_RE) ?? []) {
    if (!isPlausibleCall(m) || seen.has(m)) continue;
    seen.add(m);
    found.push(m);
  }
  return found;
}

export function assignResolvedCalls(
  rows: Array<{ plant: string; matDoc: string; callNo: string }>,
  registered: ReadonlySet<string>
): string[] {
  const resolved = rows.map(() => '');
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = r.matDoc ? `${r.plant}|${r.matDoc}` : `${r.plant}|#${i}`;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  });

  for (const idxs of groups.values()) {
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const i of idxs) {
      for (const t of extractCallNumbers(rows[i].callNo)) {
        if (seen.has(t)) continue;
        seen.add(t);
        tokens.push(t);
      }
    }
    const inReg = tokens.filter((t) => registered.has(t));
    const pool = inReg.length > 0 ? inReg : tokens;
    if (pool.length <= 1) {
      const only = pool[0] ?? '';
      for (const i of idxs) resolved[i] = only;
      continue;
    }
    idxs.forEach((rowIdx, n) => {
      resolved[rowIdx] = pool[n] ?? '';
    });
  }
  return resolved;
}
