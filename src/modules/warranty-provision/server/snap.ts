import { withAppClient } from '@/lib/read-model/db';
import {
  fyLabel,
  fyStartIso,
  fyEndIso,
  fyStartYear,
  todayIsoIst,
} from '@/modules/warranty-provision/fy';

export type SnapQuery = {
  asOf: string;
  strict: boolean;
  fyFrom: number | null;
  fyCount: number;
};

export type SnapResponse = {
  asOf: string;
  strict: boolean;
  fys: string[];
  fyStarts: number[];
  rows: Array<{ year: number; units: number; values: number[]; total: number }>;
  totals: number[];
  grandTotal: number;
  totalUnits: number;
};

function parseAsOf(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayIsoIst();
}

/** Shared SNAP aggregation — Grand Total is the exposure base for claim rates. */
export async function querySnapReport(q: SnapQuery): Promise<SnapResponse> {
  const asOf = parseAsOf(q.asOf);
  const first = q.fyFrom ?? fyStartYear(asOf);
  const count = Math.min(15, Math.max(1, q.fyCount || 6));
  const fyStarts = Array.from({ length: count }, (_, i) => first + i);
  const fys = fyStarts.map(fyLabel);

  return withAppClient(async (client) => {
    const exprs: string[] = [];
    const params: unknown[] = [asOf];
    let p = 2;
    for (const y of fyStarts) {
      const fs = fyStartIso(y);
      const fe = fyEndIso(y);
      params.push(fs, fe);
      const fsP = p++;
      const feP = p++;
      const lo = q.strict
        ? `GREATEST($1::date, $${fsP}::date, warranty_start)`
        : `GREATEST($1::date, $${fsP}::date)`;
      exprs.push(`
        SUM(
          CASE
            WHEN COALESCE(days, 0) = 0 OR warranty_end_date IS NULL THEN 0
            ELSE GREATEST(
              0,
              (LEAST(warranty_end_date, $${feP}::date) - ${lo})::numeric
              / NULLIF(($${feP}::date - $${fsP}::date), 0)
            )
          END
        ) AS c${exprs.length}
      `);
    }

    // Period as-of is 1st of next month; billing_date < asOf = on/before selected month-end
    // (Excel "active as on 30.09.2026" must not include October billings).
    const { rows } = await client.query(
      `
      SELECT
        COALESCE(billing_year, 0) AS yr,
        COUNT(*)::int AS units,
        ${exprs.join(',\n')}
      FROM warranty_provision_rows
      WHERE billing_date IS NOT NULL
        AND billing_date < $1::date
      GROUP BY COALESCE(billing_year, 0)
      ORDER BY 1
      `,
      params
    );

    const totals = fyStarts.map(() => 0);
    const outRows = rows.map((r) => {
      const values = fyStarts.map((_, i) => Number(r[`c${i}`] ?? 0) || 0);
      values.forEach((v, i) => {
        totals[i] += v;
      });
      return {
        year: Number(r.yr) || 0,
        units: Number(r.units) || 0,
        values,
        total: values.reduce((a, b) => a + b, 0),
      };
    });

    return {
      asOf,
      strict: q.strict,
      fys,
      fyStarts,
      rows: outRows,
      totals,
      grandTotal: totals.reduce((a, b) => a + b, 0),
      totalUnits: outRows.reduce((a, r) => a + r.units, 0),
    };
  });
}

/**
 * Exposure base for claim-rate = SNAP Grand Total under the same as-of/strict/FY window.
 * Same coverage math as querySnapReport, without the billing-year pivot.
 */
export async function snapExposureUnitYears(q: SnapQuery): Promise<number> {
  const asOf = parseAsOf(q.asOf);
  const first = q.fyFrom ?? fyStartYear(asOf);
  const count = Math.min(15, Math.max(1, q.fyCount || 6));
  const fyStarts = Array.from({ length: count }, (_, i) => first + i);

  return withAppClient(async (client) => {
    const exprs: string[] = [];
    const params: unknown[] = [asOf];
    let p = 2;
    for (const y of fyStarts) {
      const fs = fyStartIso(y);
      const fe = fyEndIso(y);
      params.push(fs, fe);
      const fsP = p++;
      const feP = p++;
      const lo = q.strict
        ? `GREATEST($1::date, $${fsP}::date, warranty_start)`
        : `GREATEST($1::date, $${fsP}::date)`;
      exprs.push(`
        COALESCE(SUM(
          CASE
            WHEN COALESCE(days, 0) = 0 OR warranty_end_date IS NULL THEN 0
            ELSE GREATEST(
              0,
              (LEAST(warranty_end_date, $${feP}::date) - ${lo})::numeric
              / NULLIF(($${feP}::date - $${fsP}::date), 0)
            )
          END
        ), 0)
      `);
    }
    const { rows } = await client.query(
      `
      SELECT (${exprs.join(' + ')})::float8 AS grand
      FROM warranty_provision_rows
      WHERE billing_date IS NOT NULL
        AND billing_date < $1::date
      `,
      params
    );
    return Number(rows[0]?.grand ?? 0) || 0;
  });
}

export { parseAsOf };
