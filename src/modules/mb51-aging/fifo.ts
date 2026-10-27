import type {
  Mb51AgingAggRow,
  Mb51AgingBucket,
  Mb51AgingMovement,
  Mb51AgingResult,
} from '@/modules/mb51-aging/types';

/** Known defective codes from MB51_Aging_Report.html — suggested defaults only. */
export const DEFAULT_DEFECTIVE_MATERIALS = [
  '1301709',
  '1301712',
  '1301714',
  '2303393',
  '2303396',
  '2303398',
] as const;

export const BUCKETS: Mb51AgingBucket[] = [
  { k: 'b1', l: 'Below 30 days', min: 0, max: 30, c: 'var(--b1)' },
  { k: 'b2', l: '31 to 90 days', min: 31, max: 90, c: 'var(--b2)' },
  { k: 'b3', l: '91 to 180 days', min: 91, max: 180, c: 'var(--b3)' },
  { k: 'b4', l: '180 to 365 days', min: 181, max: 365, c: 'var(--b4)' },
  { k: 'b5', l: '1 year to 2 years', min: 366, max: 730, c: 'var(--b5)' },
  { k: 'b6', l: '2 to 3 years', min: 731, max: 1095, c: 'var(--b6)' },
  { k: 'b7', l: 'More than 3 years', min: 1096, max: 1e9, c: 'var(--b7)' },
];

/**
 * FIFO aging matching MB51_Aging_Report.html:
 * closing balance = net qty in [from, min(basis,to)], allocated to latest receipts in that window.
 */
export function computeFifoAging(opts: {
  rows: Mb51AgingMovement[];
  basis: number;
  from: number;
  to: number;
  groupBy: 'mat' | 'vendor' | 'group' | 'vm';
  selectedPlants: Set<string>;
  selectedVendors: Set<string>;
  selectedGroups: Set<string>;
  selectedMaterials: Set<string>;
  /** Materials to drop from aging (any codes the user picks). */
  excludedMaterials?: Set<string>;
  maxD: number;
}): Mb51AgingResult | null {
  const {
    rows,
    basis,
    from,
    to,
    groupBy,
    selectedPlants,
    selectedVendors,
    selectedGroups,
    selectedMaterials,
    excludedMaterials,
    maxD,
  } = opts;
  const excluded = excludedMaterials ?? new Set<string>();

  if (!rows.length || basis == null || Number.isNaN(basis)) return null;
  const lim = Math.min(basis, to);

  const m = new Map<string, Mb51AgingMovement[]>();
  for (const r of rows) {
    const k = `${r.mv}|${r.v}|${r.m}|${r.u}`;
    let a = m.get(k);
    if (!a) {
      a = [];
      m.set(k, a);
    }
    a.push(r);
  }
  const groups = [...m.values()];
  groups.forEach((a) => a.sort((x, y) => x.d - y.d || x.s - y.s));

  const agg = new Map<string, Mb51AgingAggRow>();
  const tot = BUCKETS.map(() => 0);
  let layers = 0,
    negMat = 0,
    negQty = 0,
    plugged = 0,
    plugQty = 0,
    stockMat = 0,
    fullTot = 0;
  const EPS = 1e-6;

  const mk = (r: Mb51AgingMovement): Mb51AgingAggRow => {
    let key = '';
    let o: Partial<Mb51AgingAggRow> = {};
    switch (groupBy) {
      case 'vendor':
        key = `${r.v}|${r.u}`;
        o = { a: r.v, b: r.vn, c: '', d: '', u: r.u };
        break;
      case 'group':
        key = `${r.g}|${r.u}`;
        o = { a: '', b: '', c: r.g, d: '', u: r.u };
        break;
      case 'vm':
        key = `${r.v}|${r.m}|${r.u}`;
        o = { a: r.v, b: r.vn, c: r.g, d: r.m, e: r.md, u: r.u };
        break;
      default:
        key = `${r.m}|${r.u}`;
        o = { a: '', b: '', c: r.g, d: r.m, e: r.md, u: r.u };
    }
    let rec = agg.get(key);
    if (!rec) {
      rec = {
        bk: BUCKETS.map(() => 0),
        det: BUCKETS.map(() => []),
        total: 0,
        full: 0,
        fg: [],
        n: 0,
        ...o,
      };
      agg.set(key, rec);
    }
    return rec;
  };

  for (const a of groups) {
    const f = a[0];
    if (excluded.size && excluded.has(f.m)) continue;
    if (selectedPlants.size && !selectedPlants.has(f.mv)) continue;
    if (selectedVendors.size && !selectedVendors.has(f.v)) continue;
    if (selectedGroups.size && !selectedGroups.has(f.g)) continue;
    if (selectedMaterials.size && !selectedMaterials.has(f.m)) continue;

    let full = 0;
    for (const r of a) full += r.q;

    let bal = 0;
    let first: Mb51AgingMovement | null = null;
    for (const r of a) {
      if (r.d > lim) break;
      if (r.d < from) continue;
      if (!first) first = r;
      bal += r.q;
    }

    const lay: [Mb51AgingMovement, number][] = [];
    if (bal <= EPS) {
      if (bal < -EPS) {
        negMat++;
        negQty += bal;
      }
    } else {
      stockMat++;
      let rem = bal;
      for (let i = a.length - 1; i >= 0 && rem > EPS; i--) {
        const r = a[i];
        if (r.d > lim || r.d < from || r.q <= 0) continue;
        const take = Math.min(r.q, rem);
        rem -= take;
        lay.push([r, take]);
      }
      if (rem > EPS && first) {
        lay.push([
          {
            d: first.d,
            v: first.v,
            vn: first.vn,
            m: first.m,
            md: first.md,
            g: first.g,
            u: first.u,
            mv: first.mv,
            dc: '(balance not covered by receipts in file)',
            mt: '',
            mtx: '',
            tx: '',
            q: rem,
            s: first.s,
          },
          rem,
        ]);
        plugged++;
        plugQty += rem;
      }
    }

    const touched = new Set<Mb51AgingAggRow>();
    for (const [r, q] of lay) {
      const age = basis - r.d;
      let bi = 0;
      while (bi < BUCKETS.length - 1 && age > BUCKETS[bi].max) bi++;
      const rec = mk(r);
      rec.det[bi].push([r, q, age]);
      rec.bk[bi] += q;
      rec.total += q;
      rec.n++;
      tot[bi] += q;
      layers++;
      touched.add(rec);
    }
    if (!touched.size && Math.abs(full) > EPS) touched.add(mk(f));
    touched.forEach((rec) => {
      rec.full += full;
      rec.fg.push([a, full]);
    });
    if (touched.size) fullTot += full;
  }

  return {
    rows: [...agg.values()],
    tot,
    gb: groupBy,
    basis,
    from,
    to,
    maxD,
    fullTot,
    used: layers,
    negMat,
    negQty,
    plugged,
    plugQty,
    stockMat,
  };
}

export function bucketOf(age: number): number {
  let i = 0;
  while (i < BUCKETS.length - 1 && age > BUCKETS[i].max) i++;
  return i;
}
