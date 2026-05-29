import { prisma } from '@/lib/prisma';

export async function queryOfficesFromPostgres(assignedOffices: string[], isHod: boolean) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ncode: number; vcompanyname: string | null; nunder: number | null }>
  >(
    `
    SELECT ncode, vcompanyname, nunder
    FROM dim_offices
    ORDER BY vcompanyname ASC
    `
  );

  const mapped = rows.map((row) => ({
    ncode: String(row.ncode),
    vcompanyname: row.vcompanyname,
    nunder: row.nunder != null ? String(row.nunder) : null,
  }));

  if (isHod) return mapped;
  return mapped.filter(
    (o) =>
      assignedOffices.includes(o.ncode) ||
      (o.nunder != null && assignedOffices.includes(o.nunder))
  );
}

export async function queryCallTypesFromPostgres() {
  const rows = await prisma.$queryRawUnsafe<Array<{ display_value: string }>>(
    `
    SELECT DISTINCT call_type AS display_value
    FROM calls_latest_hot
    WHERE call_type IS NOT NULL
      AND btrim(call_type) <> ''
    ORDER BY display_value ASC
    `
  );
  return rows.map((row) => row.display_value);
}

export type DimEngineerRow = {
  ncode: string;
  vname: string;
  nofficeid: string | null;
};

export async function queryEngineersFromPostgres(branchName: string): Promise<string[]> {
  const rows = await queryEngineerRowsFromPostgres({ branchName });
  return rows.map((row) => row.vname);
}

/** Engineers under a branch office (branch id) or branch name (legacy). */
export async function queryEngineerRowsFromPostgres(params: {
  branchId?: string;
  branchName?: string;
}): Promise<DimEngineerRow[]> {
  const { branchId, branchName } = params;
  if (!branchId && !branchName) return [];

  let rows: Array<{ ncode: number; vname: string | null; nofficeid: number | null }>;

  if (branchId) {
    const branchIdNum = Number(branchId);
    if (Number.isNaN(branchIdNum)) return [];
    rows = await prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT e.ncode, e.vname, e.nofficeid
      FROM dim_engineers e
      JOIN dim_offices o ON o.ncode = e.nofficeid
      WHERE (o.ncode = $1 OR o.nunder = $1)
        AND e.vname IS NOT NULL
        AND btrim(e.vname) <> ''
      ORDER BY e.vname ASC
      `,
      branchIdNum
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT e.ncode, e.vname, e.nofficeid
      FROM dim_engineers e
      JOIN dim_offices o ON o.ncode = e.nofficeid
      WHERE o.vcompanyname = $1
        AND e.vname IS NOT NULL
        AND btrim(e.vname) <> ''
      ORDER BY e.vname ASC
      `,
      branchName!
    );
  }

  return rows.map((row) => ({
    ncode: String(row.ncode),
    vname: String(row.vname ?? '').trim(),
    nofficeid: row.nofficeid != null ? String(row.nofficeid) : null,
  }));
}
