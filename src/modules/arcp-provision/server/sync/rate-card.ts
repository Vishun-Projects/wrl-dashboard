import { postQuery } from '@/lib/db/proxy';
import { withClient } from '@/lib/read-model/db';
import { isProvisionMajorRepair } from '@/modules/arcp-provision/server/major-repair';

export const ARCP_RATE_CARD_ENTITY = 'arcp_rate_card_hot';

const RATE_CARD_SQL = `
SELECT
  TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))), '') AS BIGINT) AS ncode,
  TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(noffice AS VARCHAR(50)))), '') AS BIGINT) AS noffice,
  TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(nofficeid AS VARCHAR(50)))), '') AS BIGINT) AS nofficeid,
  NULLIF(LTRIM(RTRIM(CAST(nitemcategory AS VARCHAR(50)))), '') AS nitemcategory,
  NULLIF(LTRIM(RTRIM(CAST(nlocalupcountry AS VARCHAR(50)))), '') AS nlocalupcountry,
  NULLIF(LTRIM(RTRIM(CAST(nrepairtype AS VARCHAR(50)))), '') AS nrepairtype,
  NULLIF(LTRIM(RTRIM(CAST(ncalltype AS VARCHAR(50)))), '') AS ncalltype,
  NULLIF(LTRIM(RTRIM(CAST(nclient AS VARCHAR(50)))), '') AS nclient,
  NULLIF(LTRIM(RTRIM(CAST(ntraveltype AS VARCHAR(50)))), '') AS ntraveltype,
  TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(nTATFrom AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) AS ntat_from,
  TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(nTATTo AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) AS ntat_to,
  TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(nchargespayable AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) AS nchargespayable,
  TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(nchargesreceivable AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT) AS nchargesreceivable
FROM mstarcpcccr (NOLOCK)
WHERE TRY_CAST(NULLIF(LTRIM(RTRIM(CAST(ncode AS VARCHAR(50)))), '') AS BIGINT) IS NOT NULL
`.trim();

function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseBigInt(value: unknown): number | null {
  const n = parseNum(value);
  return n != null && Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseCode(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '0') return null;
  return s;
}

export type ArcpRateCardHotRow = {
  ncode: number;
  noffice: number | null;
  nofficeid: number | null;
  nitemcategory: string | null;
  nlocalupcountry: string | null;
  nrepairtype: string | null;
  ncalltype: string | null;
  nclient: string | null;
  ntraveltype: string | null;
  ntat_from: number | null;
  ntat_to: number | null;
  nchargespayable: number | null;
  nchargesreceivable: number | null;
};

export function transformRateCardCrmRow(row: Record<string, unknown>): ArcpRateCardHotRow | null {
  const ncode = parseBigInt(row.ncode);
  if (ncode == null) return null;
  const nofficeid = parseBigInt(row.nofficeid) ?? parseBigInt(row.noffice);
  return {
    ncode,
    noffice: parseBigInt(row.noffice),
    nofficeid,
    nitemcategory: parseCode(row.nitemcategory),
    nlocalupcountry: parseCode(row.nlocalupcountry),
    nrepairtype: parseCode(row.nrepairtype),
    ncalltype: parseCode(row.ncalltype),
    nclient: parseCode(row.nclient),
    ntraveltype: parseCode(row.ntraveltype),
    ntat_from: parseNum(row.ntat_from ?? row.nTATFrom),
    ntat_to: parseNum(row.ntat_to ?? row.nTATTo),
    nchargespayable: parseNum(row.nchargespayable),
    nchargesreceivable: parseNum(row.nchargesreceivable),
  };
}

/**
 * Pick pay rate for a line. Rate cards are keyed by branch (`noffice`);
 * lines match via office_under (franchisee → parent branch).
 * Empty repair/calltype on either side = wildcard.
 */
export function pickRateCardUnit(
  cards: ArcpRateCardHotRow[],
  line: {
    nofficeid: number;
    office_under?: number | null;
    nitemcategory: string | null;
    nlocalupcountry: string | null;
    nrepairtype: string | null;
    ncalltype?: string | null;
    ntat: number | null;
  }
): number | null {
  const branchId = line.office_under ?? line.nofficeid;
  const cat = (line.nitemcategory ?? '').trim();
  const local = (line.nlocalupcountry ?? '').trim();
  const repair = (line.nrepairtype ?? '').trim();
  const callType = (line.ncalltype ?? '').trim();
  const major = isProvisionMajorRepair(line.nrepairtype, null);
  const candidates = cards.filter((c) => {
    const office = c.noffice ?? c.nofficeid;
    if (office == null || office !== branchId) return false;
    if ((c.nitemcategory ?? '').trim() !== cat) return false;
    if ((c.nlocalupcountry ?? '').trim() !== local) return false;
    const rcRepair = (c.nrepairtype ?? '').trim();
    if (major) {
      if (!(rcRepair === repair || rcRepair === '6' || rcRepair === '19')) return false;
    } else if (rcRepair) {
      return false;
    }
    const rcCall = (c.ncalltype ?? '').trim();
    if (rcCall && callType && rcCall !== callType) return false;
    if (line.ntat != null && c.ntat_from != null && c.ntat_to != null) {
      if (line.ntat < c.ntat_from || line.ntat > c.ntat_to) return false;
    }
    return c.nchargespayable != null;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const rank = (c: ArcpRateCardHotRow) => {
      const rc = (c.nrepairtype ?? '').trim();
      if (repair && rc === repair) return 0;
      if (major && (rc === '6' || rc === '19')) return 1;
      if (!major && !rc) return 0;
      return 2;
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return (a.ntat_from ?? 0) - (b.ntat_from ?? 0);
  });
  return candidates[0]?.nchargespayable ?? null;
}

export function rateCardExpectedTotal(unit: number | null, qty: number): number | null {
  if (unit == null || !Number.isFinite(unit) || qty <= 0) return null;
  return unit * qty;
}

export function rateCardVariance(crmCharged: number, expected: number | null): number | null {
  if (expected == null) return null;
  return crmCharged - expected;
}

export type ArcpRateCardSyncResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  rowsUpserted: number;
};

export async function runArcpRateCardSync(): Promise<ArcpRateCardSyncResult> {
  if (process.env.SYNC_ARCP_ENABLED !== 'true') {
    return { ok: true, skipped: true, reason: 'SYNC_ARCP_ENABLED is not true', rowsUpserted: 0 };
  }

  const res = await postQuery({ rawSql: RATE_CARD_SQL, timeoutMs: 120_000 });
  const raw = (res.data || []) as Record<string, unknown>[];
  const rows: ArcpRateCardHotRow[] = [];
  for (const row of raw) {
    const hot = transformRateCardCrmRow(row);
    if (hot) rows.push(hot);
  }

  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS arcp_rate_card_hot (
        ncode                   bigint NOT NULL,
        noffice                 bigint,
        nofficeid               bigint,
        nitemcategory           varchar(50),
        nlocalupcountry         varchar(50),
        nrepairtype             varchar(50),
        ncalltype               varchar(50),
        nclient                 varchar(50),
        ntraveltype             varchar(50),
        ntat_from               numeric,
        ntat_to                 numeric,
        nchargespayable         numeric,
        nchargesreceivable      numeric,
        synced_at               timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT arcp_rate_card_hot_pkey PRIMARY KEY (ncode)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_arcp_rate_card_match
        ON arcp_rate_card_hot (nofficeid, nitemcategory, nlocalupcountry, nrepairtype)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_arcp_rate_card_noffice_cat_local
        ON arcp_rate_card_hot (noffice, nitemcategory, nlocalupcountry)
    `);
    await client.query(`TRUNCATE arcp_rate_card_hot`);
    const batchSize = 200;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      batch.forEach((row, idx) => {
        const o = idx * 13;
        placeholders.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13})`
        );
        values.push(
          row.ncode,
          row.noffice,
          row.nofficeid,
          row.nitemcategory,
          row.nlocalupcountry,
          row.nrepairtype,
          row.ncalltype,
          row.nclient,
          row.ntraveltype,
          row.ntat_from,
          row.ntat_to,
          row.nchargespayable,
          row.nchargesreceivable
        );
      });
      await client.query(
        `
        INSERT INTO arcp_rate_card_hot (
          ncode, noffice, nofficeid, nitemcategory, nlocalupcountry, nrepairtype,
          ncalltype, nclient, ntraveltype, ntat_from, ntat_to, nchargespayable, nchargesreceivable
        ) VALUES ${placeholders.join(', ')}
        `,
        values
      );
    }
    await client.query(
      `
      INSERT INTO sync_state (entity, status, last_run_at, rows_upserted_last, is_running)
      VALUES ($1, 'ok', now(), $2, false)
      ON CONFLICT (entity) DO UPDATE SET
        status = 'ok',
        last_run_at = now(),
        rows_upserted_last = EXCLUDED.rows_upserted_last,
        is_running = false
      `,
      [ARCP_RATE_CARD_ENTITY, rows.length]
    );
  });

  console.log(`[arcp-rate-card] Synced ${rows.length} rows from mstarcpcccr`);
  return { ok: true, rowsUpserted: rows.length };
}
