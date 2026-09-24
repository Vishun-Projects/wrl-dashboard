/** Collapse Cadburry / CADBURRY to one label; keep mixed case when both exist. */
export function foldAccountName(map: Map<string, string>, raw: string) {
  const v = raw.trim();
  if (!v) return;
  const key = v.toUpperCase();
  const prev = map.get(key);
  if (!prev || (prev === prev.toUpperCase() && v !== v.toUpperCase())) {
    map.set(key, v);
  }
}
