import { withAppClient } from '@/lib/read-model/db';
import { parseAsOf } from '@/modules/warranty-provision/server/snap';

export type ActiveUnitsRow = {
  year: number;
  qtyMfg: number;
  qtyBilling: number;
};

export type ActiveUnitsResponse = {
  asOf: string;
  rows: ActiveUnitsRow[];
  totalMfg: number;
  totalBilling: number;
};

/**
 * Active = warranty_end_date > as-of.
 * Mfg year = Excel IF(LEN(serial)=14, MID(serial,6,2)+2000, YEAR(billing_date)).
 * Billing year = billing_year column.
 */
export async function queryActiveUnitsByYear(asOfRaw: string): Promise<ActiveUnitsResponse> {
  const asOf = parseAsOf(asOfRaw);
  return withAppClient(async (client) => {
    const { rows } = await client.query<{
      year: number;
      qty_mfg: string;
      qty_billing: string;
    }>(
      `
      WITH active AS (
        SELECT
          billing_year AS billing_y,
          CASE
            WHEN length(btrim(serial_number)) = 14
              AND substring(btrim(serial_number) FROM 6 FOR 2) ~ '^[0-9]{2}$'
            THEN 2000 + (substring(btrim(serial_number) FROM 6 FOR 2))::int
            ELSE COALESCE(
              billing_year,
              EXTRACT(YEAR FROM billing_date)::int
            )
          END AS mfg_y
        FROM warranty_provision_rows
        WHERE warranty_end_date IS NOT NULL
          AND warranty_end_date > $1::date
      ),
      mfg AS (
        SELECT mfg_y AS year, COUNT(*)::bigint AS qty
        FROM active
        WHERE mfg_y IS NOT NULL
        GROUP BY 1
      ),
      bill AS (
        SELECT billing_y AS year, COUNT(*)::bigint AS qty
        FROM active
        WHERE billing_y IS NOT NULL
        GROUP BY 1
      )
      SELECT
        COALESCE(mfg.year, bill.year)::int AS year,
        COALESCE(mfg.qty, 0)::text AS qty_mfg,
        COALESCE(bill.qty, 0)::text AS qty_billing
      FROM mfg
      FULL OUTER JOIN bill ON bill.year = mfg.year
      ORDER BY 1
      `,
      [asOf]
    );

    const out = rows.map((r) => ({
      year: Number(r.year) || 0,
      qtyMfg: Number(r.qty_mfg) || 0,
      qtyBilling: Number(r.qty_billing) || 0,
    }));

    return {
      asOf,
      rows: out,
      totalMfg: out.reduce((a, r) => a + r.qtyMfg, 0),
      totalBilling: out.reduce((a, r) => a + r.qtyBilling, 0),
    };
  });
}
