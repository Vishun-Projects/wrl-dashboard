import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';

type Queryable = {
  query: <T>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

/**
 * Branch labels on compressor_barcodes are parent BRANCH vcompanyname values
 * (e.g. "1173 - DELHI BRANCH"), while office_ids often lists franchisees under
 * those branches. Include: assigned offices, their children, and parents of assigned.
 */
export async function resolveAllowedCompressorBranchNames(
  client: Queryable,
  isHod: boolean,
  assignedOffices: string[]
): Promise<string[] | null> {
  if (!shouldRestrictToAssignedOffices(isHod, assignedOffices)) return null;

  const ids = assignedOffices.map(Number).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];

  const res = await client.query<{ name: string }>(
    `
    SELECT DISTINCT NULLIF(btrim(x.name), '') AS name
    FROM (
      -- offices in scope (assigned + children under assigned)
      SELECT o.vcompanyname AS name
      FROM dim_offices o
      WHERE o.ncode = ANY($1::bigint[]) OR o.nunder = ANY($1::bigint[])
      UNION
      -- parent of each assigned office (franchisee → branch label)
      SELECT p.vcompanyname
      FROM dim_offices o
      JOIN dim_offices p ON p.ncode = o.nunder
      WHERE o.ncode = ANY($1::bigint[])
    ) x
    WHERE NULLIF(btrim(x.name), '') IS NOT NULL
    `,
    [ids]
  );
  return res.rows.map((r) => r.name);
}

/** SQL fragment + params for branch_name scope on compressor_barcodes. */
export function compressorBranchScopeClause(
  allowedNames: string[] | null,
  startParamIdx: number
): { sql: string; values: unknown[]; nextIdx: number } {
  if (allowedNames == null) {
    return { sql: '', values: [], nextIdx: startParamIdx };
  }
  return {
    sql: ` AND branch_name = ANY($${startParamIdx}::text[])`,
    values: [allowedNames],
    nextIdx: startParamIdx + 1,
  };
}
