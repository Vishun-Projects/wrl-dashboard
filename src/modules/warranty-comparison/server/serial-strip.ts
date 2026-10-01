import 'server-only';

/** Inclusive end (end+1 day), then round up to a 6-month step. Same day → 0. */
export const WARRANTY_MONTHS_SQL = `CASE
  WHEN w.warr_start_dt IS NULL OR w.warr_end_dt IS NULL THEN NULL
  ELSE (
    SELECT CASE WHEN m <= 0 THEN 0 ELSE (CEIL(m / 6.0) * 6)::int END
    FROM (
      SELECT (
        EXTRACT(YEAR FROM age(w.warr_end_dt + 1, w.warr_start_dt)) * 12
        + EXTRACT(MONTH FROM age(w.warr_end_dt + 1, w.warr_start_dt))
      )::int AS m
    ) span
  )
END`;

export type WarrantySerialStrip = {
  warrantyMonths: number | null;
  warrStartDt: string | null;
  warrEndDt: string | null;
  crmAccount: string | null;
  systemAccount: string | null;
  fgModel: string | null;
  billingDoc: string | null;
  callWco: string | null;
};

type Queryable = {
  query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

/** Equality joins so serial indexes on master + calls_latest_hot can be used. */
export function buildWarrantyStripBySerialsSql(): string {
  return `
    SELECT DISTINCT ON (s.serial)
      s.serial,
      ${WARRANTY_MONTHS_SQL} AS "warrantyMonths",
      TO_CHAR(w.warr_start_dt, 'YYYY-MM-DD') AS "warrStartDt",
      TO_CHAR(w.warr_end_dt, 'YYYY-MM-DD') AS "warrEndDt",
      NULLIF(BTRIM(c.account), '') AS "crmAccount",
      COALESCE(NULLIF(BTRIM(w.customer_subgroup), ''), NULLIF(BTRIM(w.customer_name), '')) AS "systemAccount",
      NULLIF(BTRIM(w.material), '') AS "fgModel",
      NULLIF(BTRIM(w.billing_doc), '') AS "billingDoc",
      NULLIF(BTRIM(c.wco), '') AS "callWco"
    FROM (
      SELECT DISTINCT BTRIM(x) AS raw, UPPER(BTRIM(x)) AS serial
      FROM unnest($1::text[]) AS t(x)
      WHERE NULLIF(BTRIM(x), '') IS NOT NULL
    ) s
    LEFT JOIN public.warranty_master_items w
      ON w.serial_no = s.raw OR w.serial_no = s.serial
    LEFT JOIN LATERAL (
      SELECT account, wco
      FROM public.calls_latest_hot
      WHERE serial = s.raw OR serial = s.serial
      ORDER BY logged_at DESC NULLS LAST
      LIMIT 1
    ) c ON true
    ORDER BY s.serial, w.warr_end_dt DESC NULLS LAST
  `;
}

export async function fetchWarrantyStripsBySerials(
  client: Queryable,
  serials: string[]
): Promise<Map<string, WarrantySerialStrip>> {
  const unique = [...new Set(serials.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, WarrantySerialStrip>();
  if (unique.length === 0) return out;

  const res = await client.query<{
    serial: string;
    warrantyMonths: number | null;
    warrStartDt: string | null;
    warrEndDt: string | null;
    crmAccount: string | null;
    systemAccount: string | null;
    fgModel: string | null;
    billingDoc: string | null;
    callWco: string | null;
  }>(buildWarrantyStripBySerialsSql(), [unique]);

  for (const row of res.rows) {
    const strip: WarrantySerialStrip = {
      warrantyMonths: row.warrantyMonths,
      warrStartDt: row.warrStartDt,
      warrEndDt: row.warrEndDt,
      crmAccount: row.crmAccount,
      systemAccount: row.systemAccount,
      fgModel: row.fgModel,
      billingDoc: row.billingDoc,
      callWco: row.callWco,
    };
    out.set(row.serial, strip);
  }
  return out;
}
