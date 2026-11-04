import ExcelJS from 'exceljs';
import { withAppClient } from '@/lib/read-model/db';
import type { WarrantyAssumptions, WarrantyClaimRow } from '@/modules/warranty-provision/types';

function pgDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapClaim(r: Record<string, unknown>): WarrantyClaimRow {
  return {
    id: Number(r.id) || 0,
    claimNo: String(r.claim_no ?? ''),
    serialNumber: String(r.serial_number ?? ''),
    claimDate: pgDate(r.claim_date),
    defectDescription: String(r.defect_description ?? ''),
    repairCost: num(r.repair_cost),
    sparePartsCost: num(r.spare_parts_cost),
    labourCost: num(r.labour_cost),
    replacementCost: num(r.replacement_cost),
    totalCost: num(r.total_cost),
    unitId: r.unit_id == null ? null : Number(r.unit_id),
    matchStatus: String(r.match_status ?? 'unmatched'),
  };
}

const HEADERS: Record<string, string> = {
  serialnumber: 'serial',
  claimdate: 'claim_date',
  claimno: 'claim_no',
  jobno: 'claim_no',
  claimjobno: 'claim_no',
  failuredefectdescription: 'defect',
  defectdescription: 'defect',
  repaircost: 'repair',
  sparepartscost: 'spares',
  labourcost: 'labour',
  laborcost: 'labour',
  replacementcost: 'replacement',
  totalcost: 'total',
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) return cellText((v as { result: unknown }).result);
  if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text: unknown }).text ?? '').trim();
  if (v instanceof Date) return '';
  return String(v).trim();
}

function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 100000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return cellDate(new Date(ms));
  }
  const s = cellText(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  if (m[0].includes('-') && m[1].length === 4) return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function cellNum(v: unknown): number | null {
  if (typeof v === 'object' && v !== null && 'result' in v) return cellNum((v as { result: unknown }).result);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ClaimParseRow = {
  claimNo: string;
  serialNumber: string;
  claimDate: string | null;
  defect: string;
  repair: number | null;
  spares: number | null;
  labour: number | null;
  replacement: number | null;
  total: number | null;
  error?: string;
};

export async function parseClaimsWorkbook(buf: Buffer): Promise<{
  rows: ClaimParseRow[];
  errors: ClaimParseRow[];
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet');
  const map: Record<string, number> = {};
  ws.getRow(1).eachCell((c, i) => {
    const k = HEADERS[norm(cellText(c.value))];
    if (k) map[k] = i;
  });
  if (!map.serial || !map.claim_no) {
    throw new Error('Need Serial Number and Claim/Job No. columns');
  }

  const rows: ClaimParseRow[] = [];
  const errors: ClaimParseRow[] = [];
  const seen = new Set<string>();

  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const g = (k: string) => (map[k] ? row.getCell(map[k]).value : null);
    const serialNumber = cellText(g('serial'));
    const claimNo = cellText(g('claim_no'));
    if (!serialNumber && !claimNo) return;
    const repair = cellNum(g('repair'));
    const spares = cellNum(g('spares'));
    const labour = cellNum(g('labour'));
    const replacement = cellNum(g('replacement'));
    let total = cellNum(g('total'));
    if (total == null) {
      const parts = [repair, spares, labour, replacement].filter((x): x is number => x != null);
      total = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
    }
    const rec: ClaimParseRow = {
      claimNo,
      serialNumber,
      claimDate: cellDate(g('claim_date')),
      defect: cellText(g('defect')),
      repair,
      spares,
      labour,
      replacement,
      total,
    };
    const err: string[] = [];
    if (!claimNo) err.push('Claim No missing');
    if (!serialNumber) err.push('Serial missing');
    if (claimNo && seen.has(claimNo)) err.push('Duplicate Claim No in file');
    if (err.length) {
      errors.push({ ...rec, error: err.join('; ') });
      return;
    }
    seen.add(claimNo);
    rows.push(rec);
  });

  return { rows, errors };
}

export async function commitClaims(rows: ClaimParseRow[]): Promise<{
  inserted: number;
  matched: number;
  unmatched: number;
  outside: number;
}> {
  return withAppClient(async (client) => {
    let inserted = 0;
    let matched = 0;
    let unmatched = 0;
    let outside = 0;
    for (const r of rows) {
      const unit = await client.query<{
        id: string;
        warranty_start: Date | string | null;
        warranty_end_date: Date | string | null;
      }>(
        `
        SELECT id, warranty_start, warranty_end_date
        FROM warranty_provision_rows
        WHERE serial_number = $1
        ORDER BY id
        LIMIT 1
        `,
        [r.serialNumber]
      );
      let status = 'unmatched';
      let unitId: number | null = null;
      if (unit.rows[0]) {
        unitId = Number(unit.rows[0].id);
        const start = pgDate(unit.rows[0].warranty_start);
        const end = pgDate(unit.rows[0].warranty_end_date);
        if (r.claimDate && start && end && (r.claimDate < start || r.claimDate > end)) {
          status = 'outside_warranty';
          outside += 1;
        } else {
          status = 'matched';
          matched += 1;
        }
      } else {
        unmatched += 1;
      }

      await client.query(
        `
        INSERT INTO warranty_claims (
          claim_no, serial_number, claim_date, defect_description,
          repair_cost, spare_parts_cost, labour_cost, replacement_cost, total_cost,
          unit_id, match_status
        ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (claim_no) DO UPDATE SET
          serial_number = EXCLUDED.serial_number,
          claim_date = EXCLUDED.claim_date,
          defect_description = EXCLUDED.defect_description,
          repair_cost = EXCLUDED.repair_cost,
          spare_parts_cost = EXCLUDED.spare_parts_cost,
          labour_cost = EXCLUDED.labour_cost,
          replacement_cost = EXCLUDED.replacement_cost,
          total_cost = EXCLUDED.total_cost,
          unit_id = EXCLUDED.unit_id,
          match_status = EXCLUDED.match_status
        `,
        [
          r.claimNo,
          r.serialNumber,
          r.claimDate,
          r.defect,
          r.repair,
          r.spares,
          r.labour,
          r.replacement,
          r.total,
          unitId,
          status,
        ]
      );
      inserted += 1;
    }
    return { inserted, matched, unmatched, outside };
  });
}

export async function listClaims(opts: {
  page: number;
  pageSize: number;
  q: string;
}): Promise<{ rows: WarrantyClaimRow[]; total: number }> {
  return withAppClient(async (client) => {
    const values: unknown[] = [];
    let where = '1=1';
    if (opts.q.trim()) {
      values.push(`%${opts.q.trim()}%`);
      where += ` AND (serial_number ILIKE $1 OR claim_no ILIKE $1)`;
    }
    const count = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM warranty_claims WHERE ${where}`,
      values
    );
    const i = values.length + 1;
    const { rows } = await client.query(
      `
      SELECT * FROM warranty_claims
      WHERE ${where}
      ORDER BY claim_date DESC NULLS LAST, id DESC
      LIMIT $${i} OFFSET $${i + 1}
      `,
      [...values, opts.pageSize, (opts.page - 1) * opts.pageSize]
    );
    return {
      rows: rows.map((r) => mapClaim(r as Record<string, unknown>)),
      total: Number(count.rows[0]?.n ?? 0) || 0,
    };
  });
}

export async function getAssumptions(): Promise<WarrantyAssumptions> {
  return withAppClient(async (client) => {
    const { rows } = await client.query(`SELECT * FROM warranty_forecast_assumptions WHERE id = 1`);
    const r = rows[0];
    if (!r) {
      return {
        inflationPct: 5,
        discountPct: 8,
        optimisticProbMult: 0.8,
        optimisticCostMult: 0.9,
        pessimisticProbMult: 1.2,
        pessimisticCostMult: 1.25,
        forecastStart: null,
        includeFutureSales: false,
        existingProvision: 0,
        usingDefaults: true,
      };
    }
    return {
      inflationPct: Number(r.inflation_pct),
      discountPct: Number(r.discount_pct),
      optimisticProbMult: Number(r.optimistic_prob_mult),
      optimisticCostMult: Number(r.optimistic_cost_mult),
      pessimisticProbMult: Number(r.pessimistic_prob_mult),
      pessimisticCostMult: Number(r.pessimistic_cost_mult),
      forecastStart: pgDate(r.forecast_start),
      includeFutureSales: Boolean(r.include_future_sales),
      existingProvision: Number(r.existing_provision) || 0,
      usingDefaults: false,
    };
  });
}

export async function saveAssumptions(
  a: Partial<WarrantyAssumptions>
): Promise<WarrantyAssumptions> {
  return withAppClient(async (client) => {
    await client.query(
      `
      INSERT INTO warranty_forecast_assumptions (id) VALUES (1)
      ON CONFLICT (id) DO NOTHING
      `
    );
    await client.query(
      `
      UPDATE warranty_forecast_assumptions SET
        inflation_pct = COALESCE($1, inflation_pct),
        discount_pct = COALESCE($2, discount_pct),
        optimistic_prob_mult = COALESCE($3, optimistic_prob_mult),
        optimistic_cost_mult = COALESCE($4, optimistic_cost_mult),
        pessimistic_prob_mult = COALESCE($5, pessimistic_prob_mult),
        pessimistic_cost_mult = COALESCE($6, pessimistic_cost_mult),
        forecast_start = COALESCE($7::date, forecast_start),
        include_future_sales = COALESCE($8, include_future_sales),
        existing_provision = COALESCE($9, existing_provision),
        updated_at = now()
      WHERE id = 1
      `,
      [
        a.inflationPct ?? null,
        a.discountPct ?? null,
        a.optimisticProbMult ?? null,
        a.optimisticCostMult ?? null,
        a.pessimisticProbMult ?? null,
        a.pessimisticCostMult ?? null,
        a.forecastStart ?? null,
        a.includeFutureSales ?? null,
        a.existingProvision ?? null,
      ]
    );
    return getAssumptions();
  });
}
